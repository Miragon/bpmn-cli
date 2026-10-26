import type { Doc } from '../../model/Doc.js';
import type { ChangeSet } from '../../model/ChangeSet.js';
import type { IdState } from '../../ids/IdStyle.js';
import { modelError } from '../../shared/utils/errors.js';
import { kindLabel, triggerOf, type Trigger } from '../../model/utils/kinds.js';
import { is, type El } from '../../model/utils/moddle.js';
import { EventDefinitions } from './EventDefinitions.js';
import { EventTrigger, ALWAYS_INTERRUPTING } from './EventTrigger.js';
import { IdRenamer } from '../IdRenamer.js';
import { PropertyCoercer } from '../PropertyCoercer.js';
import { idOf } from '../../model/utils/elements.js';
import type { TriggerOptions } from '../types.js';

/**
 * Changes an element's trigger (`set trigger=`) or kind (`retype`), measured against
 * what the element was when the change began.
 */
export class TriggerChange {
  private readonly before: { trigger: Trigger; opts: TriggerOptions };
  private readonly was: Trigger | undefined;
  /** message flows that did not fit before may stay */
  private readonly conflicts: Set<string>;
  private readonly state: IdState;
  private readonly label: string;

  constructor(
    private readonly doc: Doc,
    private readonly el: El,
  ) {
    this.before = is(el, 'bpmn:Event') ? new EventTrigger(el).read() : { trigger: 'none', opts: {} };
    this.was = triggerOf(el);
    this.conflicts = new Set(TriggerChange.messageFlowConflicts(doc, el).map((conflict) => idOf(conflict.flow)));
    this.state = IdRenamer.stateOf(el);
    this.label = kindLabel(el);
  }

  get current(): { trigger: Trigger; opts: TriggerOptions } {
    return this.before;
  }

  /**
   * `on` is the element or the one a retype built in its place; no `trigger` means
   * only the kind changed. `strict` (set) checks a re-given non-interrupting flag first.
   */
  change(trigger: Trigger | undefined, given: TriggerOptions, cs: ChangeSet, { on = this.el, strict = false }: { on?: El; strict?: boolean } = {}): void {
    let dropNonInterrupting = false;
    if (trigger !== undefined) {
      const merged: TriggerOptions = trigger === this.was ? { ...this.before.opts, ...given } : { ...given };
      if (given.timer !== undefined && given.timerKind === undefined) delete merged.timerKind;
      if (given.nonInterrupting === undefined && this.before.opts.nonInterrupting) {
        if (EventTrigger.interruptingOnly(on, trigger)) {
          merged.nonInterrupting = false;
          dropNonInterrupting = true;
        } else if (strict) merged.nonInterrupting = true;
      }
      if (strict && merged.nonInterrupting) this.assertNonInterruptingAllowed(on, trigger);
      for (const warning of new EventDefinitions(this.doc, on).apply(trigger, merged)) cs.warn(warning);
    }
    this.assertMessageFlowsFit(on);
    if (dropNonInterrupting && trigger !== undefined) this.warnNonInterruptingDropped(cs, on, trigger);
    new IdRenamer(this.doc).recordState(on, this.state, this.label);
  }

  setNonInterrupting(value: boolean): void {
    const el = this.el;
    if (value) this.assertNonInterruptingAllowed(el, triggerOf(el) ?? 'none');
    if (is(el, 'bpmn:BoundaryEvent')) el.set('cancelActivity', !value);
    else if (is(el, 'bpmn:StartEvent')) el.set('isInterrupting', !value);
    else this.assertNonInterruptingAllowed(el, 'none');
  }

  /** As in `connect`: only untyped or message events; throw events send, catch events receive. */
  private static messageFlowConflicts(doc: Doc, event: El): Array<{ flow: El; why: string }> {
    if (!is(event, 'bpmn:Event')) return [];
    const trigger = triggerOf(event) ?? 'none';
    const out: Array<{ flow: El; why: string }> = [];
    for (const flow of doc.messageFlows()) {
      const sends = flow.get<El | undefined>('sourceRef') === event;
      const receives = flow.get<El | undefined>('targetRef') === event;
      if (!sends && !receives) continue;
      let why: string | undefined;
      if (trigger !== 'none' && trigger !== 'message') why = `a ${trigger} event cannot ${sends ? 'send' : 'receive'} messages`;
      else if (sends && !is(event, 'bpmn:ThrowEvent')) why = 'catching events cannot send messages';
      else if (receives && !is(event, 'bpmn:CatchEvent')) why = 'throwing events cannot receive messages';
      if (why) out.push({ flow, why });
    }
    return out;
  }

  /** So the model never ends up with a message flow `connect` would refuse. */
  private assertMessageFlowsFit(event: El): void {
    const broken = TriggerChange.messageFlowConflicts(this.doc, event).filter((conflict) => !this.conflicts.has(idOf(conflict.flow)));
    const first = broken[0];
    if (!first) return;
    const src = first.flow.get<El | undefined>('sourceRef');
    const tgt = first.flow.get<El | undefined>('targetRef');
    throw modelError(
      'E_INVALID_TRIGGER',
      `${kindLabel(event)} ${idOf(event)} would break message flow ${idOf(first.flow)} (${src ? idOf(src) : '?'} -> ${tgt ? idOf(tgt) : '?'}): ${first.why}`,
      {
        element: idOf(event),
        related: broken.map((conflict) => idOf(conflict.flow)),
        hint: `Remove the message flow first (\`bpmn remove <file> ${broken.map((conflict) => idOf(conflict.flow)).join(' ')}\`) or keep a message / untyped event.`,
      },
    );
  }

  private warnNonInterruptingDropped(cs: ChangeSet, el: El, trigger: Trigger): void {
    const position = is(el, 'bpmn:BoundaryEvent') ? 'boundary' : 'start';
    cs.warn({
      code: 'W_PROPERTY_DROPPED',
      message: `nonInterrupting of ${idOf(el)} was dropped: ${trigger === 'none' ? 'untyped' : trigger} ${position} events are always interrupting`,
      element: idOf(el),
      hint: `${idOf(el)} now interrupts${position === 'boundary' ? ' its host activity' : ' the enclosing process'}; pick a message, timer, signal, escalation or conditional trigger to keep it non-interrupting.`,
    });
  }

  private assertNonInterruptingAllowed(el: El, trigger: Trigger): void {
    if (is(el, 'bpmn:BoundaryEvent')) {
      if (ALWAYS_INTERRUPTING.includes(trigger)) {
        throw modelError('E_INVALID_TRIGGER', `${trigger} boundary events are always interrupting (${idOf(el)})`, {
          element: idOf(el),
          hint: 'Only message, timer, signal, escalation and conditional boundary events can be non-interrupting.',
        });
      }
      return;
    }
    if (is(el, 'bpmn:StartEvent')) {
      const scope = this.doc.scopeOf(el);
      if (!scope || !is(scope, 'bpmn:SubProcess') || !scope.get<boolean | undefined>('triggeredByEvent')) {
        throw modelError('E_INVALID_TRIGGER', `Start event ${idOf(el)} is not inside an event sub-process and cannot be non-interrupting`, {
          element: idOf(el),
          hint: 'Only start events of an eventSubProcess can be non-interrupting.',
        });
      }
      if (EventTrigger.interruptingOnly(el, trigger)) {
        throw modelError('E_INVALID_TRIGGER', `A${trigger === 'none' ? 'n untyped' : ` ${trigger}`} start event cannot be non-interrupting (${idOf(el)})`, {
          element: idOf(el),
          hint: 'Only message, timer, signal, escalation and conditional start events can be non-interrupting.',
        });
      }
      return;
    }
    throw PropertyCoercer.invalid(el, 'nonInterrupting', 'only boundary events and start events of event sub-processes can be non-interrupting');
  }
}
