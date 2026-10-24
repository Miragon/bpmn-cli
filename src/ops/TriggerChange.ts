/**
 * A change of an element's trigger (`set trigger=` and the trigger keys) or of
 * its kind (`retype`), from what the element was when it began: the trigger
 * options are merged with the current ones, a non-interrupting flag the new
 * trigger cannot carry is cleared (W_PROPERTY_DROPPED), the event definitions
 * change (applyTrigger), the message flows at the event must still fit it
 * (E_INVALID_TRIGGER, the rule `connect` applies), and the id state is
 * recorded for W_ID_PREFIX_STALE.
 */
import type { Doc } from '../model/Doc.js';
import type { ChangeSet } from '../model/ChangeSet.js';
import type { IdState } from '../ids/IdStyle.js';
import { modelError } from '../shared/utils/errors.js';
import { kindLabel, triggerOf, type Trigger } from '../model/kinds.js';
import { is, type El } from '../model/utils/moddle.js';
import { applyTrigger } from './events.js';
import { EventTrigger, ALWAYS_INTERRUPTING } from './EventTrigger.js';
import { IdRenamer } from './IdRenamer.js';
import { idOf } from './utils/elements.js';
import type { TriggerOptions } from './types.js';

export class TriggerChange {
  /** the trigger and its options when the change began (events only) */
  private readonly before: { trigger: Trigger; opts: TriggerOptions };
  private readonly was: Trigger | undefined;
  /** the message flows at the element that did not fit it before (they may stay) */
  private readonly conflicts: Set<string>;
  private readonly state: IdState;
  private readonly label: string;

  constructor(
    private readonly doc: Doc,
    private readonly el: El,
  ) {
    this.before = is(el, 'bpmn:Event') ? new EventTrigger(el).read() : { trigger: 'none', opts: {} };
    this.was = triggerOf(el);
    this.conflicts = new Set(TriggerChange.messageFlowConflicts(doc, el).map((c) => idOf(c.flow)));
    this.state = IdRenamer.stateOf(el);
    this.label = kindLabel(el);
  }

  /** The trigger and its options when the change began. */
  get current(): { trigger: Trigger; opts: TriggerOptions } {
    return this.before;
  }

  /**
   * Gives `on` (the element, or the one a retype built in its place) the
   * trigger `trigger` with the options `given`, merged with the current ones
   * when the trigger stays (a new timer value is classified again); no
   * trigger: the kind changed, the trigger did not. A non-interrupting flag
   * follows the event unless the new trigger cannot have it; `strict` (set):
   * the flag is given again on a trigger change and checked first, with the
   * messages of `set nonInterrupting=`. Then the message flows at the event
   * must still fit it, and the id state is recorded.
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
      for (const w of applyTrigger(this.doc, on, trigger, merged)) cs.warn(w);
    }
    this.assertMessageFlowsFit(on);
    if (dropNonInterrupting && trigger !== undefined) this.warnNonInterruptingDropped(cs, on, trigger);
    new IdRenamer(this.doc).recordState(on, this.state, this.label);
  }

  /** `set nonInterrupting=` alone: the flag of the element's current trigger. */
  setNonInterrupting(value: boolean): void {
    const el = this.el;
    if (value) this.assertNonInterruptingAllowed(el, triggerOf(el) ?? 'none');
    if (is(el, 'bpmn:BoundaryEvent')) el.set('cancelActivity', !value);
    else if (is(el, 'bpmn:StartEvent')) el.set('isInterrupting', !value);
    else this.assertNonInterruptingAllowed(el, 'none');
  }

  /**
   * Message flows touching `event` that its current kind/trigger cannot serve
   * (the rules `connect` applies when creating one): only untyped or message
   * events take part, throw events send, catch events receive.
   */
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

  /**
   * After the change: E_INVALID_TRIGGER when a message flow that fitted the
   * element before no longer does, so the model never ends up with a message
   * flow `connect` would refuse.
   */
  private assertMessageFlowsFit(event: El): void {
    const broken = TriggerChange.messageFlowConflicts(this.doc, event).filter((c) => !this.conflicts.has(idOf(c.flow)));
    const first = broken[0];
    if (!first) return;
    const src = first.flow.get<El | undefined>('sourceRef');
    const tgt = first.flow.get<El | undefined>('targetRef');
    throw modelError(
      'E_INVALID_TRIGGER',
      `${kindLabel(event)} ${idOf(event)} would break message flow ${idOf(first.flow)} (${src ? idOf(src) : '?'} -> ${tgt ? idOf(tgt) : '?'}): ${first.why}`,
      {
        element: idOf(event),
        related: broken.map((c) => idOf(c.flow)),
        hint: `Remove the message flow first (\`bpmn remove <file> ${broken.map((c) => idOf(c.flow)).join(' ')}\`) or keep a message / untyped event.`,
      },
    );
  }

  /** W_PROPERTY_DROPPED for a non-interrupting flag that a trigger change had to clear. */
  private warnNonInterruptingDropped(cs: ChangeSet, el: El, trigger: Trigger): void {
    const position = is(el, 'bpmn:BoundaryEvent') ? 'boundary' : 'start';
    cs.warn({
      code: 'W_PROPERTY_DROPPED',
      message: `nonInterrupting of ${idOf(el)} was dropped: ${trigger === 'none' ? 'untyped' : trigger} ${position} events are always interrupting`,
      element: idOf(el),
      hint: `${idOf(el)} now interrupts${position === 'boundary' ? ' its host activity' : ' the enclosing process'}; pick a message, timer, signal, escalation or conditional trigger to keep it non-interrupting.`,
    });
  }

  /** Throws unless `el` may be non-interrupting with the given trigger. */
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
    throw modelError('E_INVALID_VALUE', `Invalid value for nonInterrupting on ${idOf(el)}: only boundary events and start events of event sub-processes can be non-interrupting`, { element: idOf(el) });
  }
}
