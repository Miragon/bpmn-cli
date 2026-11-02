import { type BpmnDocument, type BpmnElement, BpmnError, type ChangeSet, EventTrigger, type IdState, Kinds, type Trigger, type TriggerOptions, Triggers } from '../../model/index.js';
import { IdRename } from '../properties/IdRename.js';
import { PropertyCoercer } from '../properties/PropertyCoercer.js';
import type { EditSession } from '../session/EditSession.js';
import { EventDefinitions } from './EventDefinitions.js';

export class TriggerChange {
  private readonly before: { trigger: Trigger; opts: TriggerOptions };
  private readonly was: Trigger | undefined;
  private readonly conflicts: Set<string>;
  private readonly state: IdState;
  private readonly label: string;

  constructor(
    private readonly edit: EditSession,
    private readonly el: BpmnElement,
  ) {
    this.before = el.is('bpmn:Event') ? new EventTrigger(el).read() : { trigger: 'none', opts: {} };
    this.was = Triggers.of(el);
    this.conflicts = new Set(TriggerChange.messageFlowConflicts(edit.document, el).map((conflict) => conflict.flow.id));
    this.state = IdRename.stateOf(el);
    this.label = Kinds.label(el);
  }

  get current(): { trigger: Trigger; opts: TriggerOptions } {
    return this.before;
  }

  change(trigger: Trigger | undefined, given: TriggerOptions, changes: ChangeSet, { on = this.el, strict = false }: { on?: BpmnElement; strict?: boolean } = {}): void {
    const dropNonInterrupting = trigger !== undefined && this.losesNonInterrupting(on, trigger, given);
    if (trigger !== undefined) {
      const merged = this.mergedOptions(on, trigger, given, strict);
      if (strict && merged.nonInterrupting) {
        this.assertNonInterruptingAllowed(on, trigger);
      }
      for (const warning of new EventDefinitions(this.edit).setTrigger(on, trigger, merged)) {
        changes.warn(warning);
      }
    }
    this.assertMessageFlowsFit(on);
    if (dropNonInterrupting && trigger !== undefined) {
      this.warnNonInterruptingDropped(changes, on, trigger);
    }
    new IdRename(this.edit).recordState(on, this.state, this.label);
  }

  private losesNonInterrupting(on: BpmnElement, trigger: Trigger, given: TriggerOptions): boolean {
    return given.nonInterrupting === undefined && !!this.before.opts.nonInterrupting && EventTrigger.interruptingOnly(on, trigger);
  }

  private mergedOptions(on: BpmnElement, trigger: Trigger, given: TriggerOptions, strict: boolean): TriggerOptions {
    const merged: TriggerOptions = trigger === this.was ? { ...this.before.opts, ...given } : { ...given };
    if (given.timer !== undefined && given.timerKind === undefined) {
      delete merged.timerKind;
    }
    if (this.losesNonInterrupting(on, trigger, given)) {
      merged.nonInterrupting = false;
    } else if (given.nonInterrupting === undefined && this.before.opts.nonInterrupting && strict) {
      merged.nonInterrupting = true;
    }
    return merged;
  }

  setNonInterrupting(value: boolean): void {
    const el = this.el;
    if (value) {
      this.assertNonInterruptingAllowed(el, Triggers.of(el) ?? 'none');
    }
    if (el.is('bpmn:BoundaryEvent')) {
      el.set('cancelActivity', !value);
    } else if (el.is('bpmn:StartEvent')) {
      el.set('isInterrupting', !value);
    } else {
      this.assertNonInterruptingAllowed(el, 'none');
    }
  }

  private static messageFlowConflicts(document: BpmnDocument, event: BpmnElement): Array<{ flow: BpmnElement; why: string }> {
    if (!event.is('bpmn:Event')) {
      return [];
    }
    const trigger = Triggers.of(event) ?? 'none';
    const out: Array<{ flow: BpmnElement; why: string }> = [];
    for (const flow of document.flows.messageFlows()) {
      const sends = flow.get<BpmnElement | undefined>('sourceRef') === event;
      const receives = flow.get<BpmnElement | undefined>('targetRef') === event;
      if (!sends && !receives) {
        continue;
      }
      const why = TriggerChange.conflictReason(event, trigger, sends, receives);
      if (why) {
        out.push({ flow, why });
      }
    }
    return out;
  }

  private static conflictReason(event: BpmnElement, trigger: Trigger, sends: boolean, receives: boolean): string | undefined {
    if (trigger !== 'none' && trigger !== 'message') {
      return `a ${trigger} event cannot ${sends ? 'send' : 'receive'} messages`;
    }
    if (sends && !event.is('bpmn:ThrowEvent')) {
      return 'catching events cannot send messages';
    }
    if (receives && !event.is('bpmn:CatchEvent')) {
      return 'throwing events cannot receive messages';
    }
    return undefined;
  }

  private assertMessageFlowsFit(event: BpmnElement): void {
    const broken = TriggerChange.messageFlowConflicts(this.edit.document, event).filter((conflict) => !this.conflicts.has(conflict.flow.id));
    const first = broken[0];
    if (!first) {
      return;
    }
    const src = first.flow.get<BpmnElement | undefined>('sourceRef');
    const tgt = first.flow.get<BpmnElement | undefined>('targetRef');
    throw BpmnError.model(
      'E_INVALID_TRIGGER',
      `${Kinds.label(event)} ${event.id} would break message flow ${first.flow.id} (${src ? src.id : '?'} -> ${tgt ? tgt.id : '?'}): ${first.why}`,
      {
        element: event.id,
        related: broken.map((conflict) => conflict.flow.id),
        hint: `Remove the message flow first (\`bpmn remove <file> ${broken.map((conflict) => conflict.flow.id).join(' ')}\`) or keep a message / untyped event.`,
      },
    );
  }

  private warnNonInterruptingDropped(changes: ChangeSet, el: BpmnElement, trigger: Trigger): void {
    const position = el.is('bpmn:BoundaryEvent') ? 'boundary' : 'start';
    changes.warn({
      code: 'W_PROPERTY_DROPPED',
      message: `nonInterrupting of ${el.id} was dropped: ${trigger === 'none' ? 'untyped' : trigger} ${position} events are always interrupting`,
      element: el.id,
      hint: `${el.id} now interrupts${position === 'boundary' ? ' its host activity' : ' the enclosing process'}; pick a message, timer, signal, escalation or conditional trigger to keep it non-interrupting.`,
    });
  }

  private assertNonInterruptingAllowed(el: BpmnElement, trigger: Trigger): void {
    if (el.is('bpmn:BoundaryEvent')) {
      if (EventTrigger.ALWAYS_INTERRUPTING.includes(trigger)) {
        throw BpmnError.model('E_INVALID_TRIGGER', `${trigger} boundary events are always interrupting (${el.id})`, {
          element: el.id,
          hint: 'Only message, timer, signal, escalation and conditional boundary events can be non-interrupting.',
        });
      }
      return;
    }
    if (el.is('bpmn:StartEvent')) {
      if (!Kinds.isEventSubProcess(this.edit.document.scopes.scopeOf(el))) {
        throw BpmnError.model('E_INVALID_TRIGGER', `Start event ${el.id} is not inside an event sub-process and cannot be non-interrupting`, {
          element: el.id,
          hint: 'Only start events of an eventSubProcess can be non-interrupting.',
        });
      }
      if (EventTrigger.interruptingOnly(el, trigger)) {
        throw BpmnError.model('E_INVALID_TRIGGER', `A${trigger === 'none' ? 'n untyped' : ` ${trigger}`} start event cannot be non-interrupting (${el.id})`, {
          element: el.id,
          hint: 'Only message, timer, signal, escalation and conditional start events can be non-interrupting.',
        });
      }
      return;
    }
    throw PropertyCoercer.invalidValue(el, 'nonInterrupting', 'only boundary events and start events of event sub-processes can be non-interrupting');
  }
}
