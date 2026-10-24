/**
 * The event definitions (triggers) of an event: timer / message / error / signal / escalation /
 * conditional / link / compensate / terminate / cancel.
 *
 *  - apply(): sets the event's trigger. When the event already has
 *    exactly one definition of that trigger, it is updated in place (other
 *    event definitions of an event that has several are dropped, reported as
 *    W_PROPERTY_DROPPED): only the
 *    details that differ (message, error, signal, escalation, condition, timer,
 *    link) change, so its id, vendor attributes (camunda:topic ...), extension
 *    elements and expression elements survive. A new inline condition (when=)
 *    replacing a script resource drops camunda:resource and its language, and
 *    a `${...}` condition drops a script language (W_PROPERTY_DROPPED). Otherwise (a trigger KIND
 *    change, 'none') the eventDefinitions are replaced by the one for
 *    `trigger` ('none' removes them) and vendor content of the replaced
 *    definitions is returned as W_PROPERTY_DROPPED warnings. Root
 *    bpmn:Message / bpmn:Error /
 *    bpmn:Signal / bpmn:Escalation elements by name when missing (ids:
 *    Message_<Slug>, Error_<Slug>, Signal_<Slug>, Escalation_<Slug>; errorCode /
 *    escalationCode from opts). Timer strings are classified: starts with "R"
 *    -> timeCycle, starts with "P" -> timeDuration, else timeDate (override
 *    with opts.timerKind). `nonInterrupting` sets cancelActivity=false on
 *    boundary events and isInterrupting=false on start events (rejected for
 *    error/cancel/compensate boundary events: E_INVALID_TRIGGER).
 */
import type { Doc } from '../model/Doc.js';
import { modelError } from '../shared/utils/errors.js';
import { type Warning } from '../shared/CliError.js';
import { kindOf, TRIGGER_TYPES, type Trigger } from '../model/kinds.js';
import { addTo, is, walk, type El, idOf } from '../model/utils/moddle.js';
import { Camunda8Defaults } from '../platform/Camunda8Defaults.js';
import { CAMUNDA } from '../platform/CamundaDescriptor.js';
import type { TriggerOptions } from './types.js';
import { vendorContent } from './utils/elements.js';
import { ALWAYS_INTERRUPTING, TIMER_PROPS } from './EventTrigger.js';
import { RootElements, type RootRefType } from './RootElements.js';

/** Start event triggers that are only valid inside an event sub-process. */
const EVENT_SUBPROCESS_ONLY: Trigger[] = ['error', 'escalation', 'compensate'];

const TIMER_KINDS = ['cycle', 'duration', 'date'] as const;
type TimerKind = (typeof TIMER_KINDS)[number];

type RefTrigger = 'message' | 'error' | 'signal' | 'escalation';

/** Reference property, root type and code option of the triggers that point at a root element. */
const REF_TRIGGERS: Record<RefTrigger, { prop: string; type: RootRefType; code?: 'errorCode' | 'escalationCode' }> = {
  message: { prop: 'messageRef', type: 'bpmn:Message' },
  error: { prop: 'errorRef', type: 'bpmn:Error', code: 'errorCode' },
  signal: { prop: 'signalRef', type: 'bpmn:Signal' },
  escalation: { prop: 'escalationRef', type: 'bpmn:Escalation', code: 'escalationCode' },
};

export class EventDefinitions {
  private readonly roots: RootElements;

  constructor(
    private readonly doc: Doc,
    private readonly event: El,
  ) {
    this.roots = new RootElements(doc);
  }

  /**
   * Sets the event's trigger. Validates the trigger against the event kind
   * and its position (start event triggers restricted to event sub-processes,
   * non-interrupting rules), then updates the existing definition in place
   * (same trigger) or swaps the event definitions (see the module contract).
   * Returns the warnings about vendor content a swap dropped.
   */
  apply(trigger: Trigger, opts: TriggerOptions = {}): Warning[] {
    if (!is(this.event, 'bpmn:Event')) {
      throw modelError('E_WRONG_KIND', `${idOf(this.event)} is not an event and cannot have a trigger`, { element: idOf(this.event) });
    }
    const def = kindOf(this.event);
    const allowed = def?.triggers ?? [];
    if (!def || !allowed.includes(trigger)) {
      throw modelError('E_INVALID_TRIGGER', `Trigger "${trigger}" is not allowed on ${def?.kind ?? this.event.$type}. Allowed: ${allowed.join(', ')}`, {
        element: idOf(this.event),
        candidates: allowed,
      });
    }
    if (is(this.event, 'bpmn:StartEvent') && EVENT_SUBPROCESS_ONLY.includes(trigger) && !EventDefinitions.isEventSubProcess(this.doc.scopeOf(this.event))) {
      throw modelError('E_INVALID_TRIGGER', `A startEvent:${trigger} is only allowed inside an event sub-process (${idOf(this.event)} is not)`, {
        element: idOf(this.event),
        hint: `Create the event sub-process together with its start in one command: \`add eventSubProcess "Handle errors" --${trigger === 'compensate' ? 'error <Name>' : `${trigger} <Name>`}\` (or eventSubProcess:${trigger}); or add the start with --in <eventSubProcessId> in the same \`apply\` batch as the eventSubProcess.`,
      });
    }
    this.applyInterrupting(trigger, opts);
    const defs = this.event.get<El[] | undefined>('eventDefinitions') ?? [];
    // the one definition of that trigger is kept (also when the event has others besides it, which go)
    const matching = trigger !== 'none' ? defs.filter((d) => is(d, TRIGGER_TYPES[trigger])) : [];
    const same = matching.length === 1 ? matching[0] : undefined;
    if (same && trigger !== 'none') {
      const others = defs.length > 1 ? this.dropOtherDefinitions(same, trigger) : [];
      const warnings = this.updateDefinition(same, trigger, opts);
      this.doc.invalidate();
      return [...others, ...warnings];
    }
    const fresh = trigger !== 'none' ? this.buildDefinition(trigger, opts) : undefined;
    const warnings = this.dropDefinitions(trigger);
    if (fresh) {
      addTo(this.event, 'eventDefinitions', fresh);
      new Camunda8Defaults(this.doc).definitionId(this.event, fresh);
    }
    this.doc.invalidate();
    return warnings;
  }

  /** Classifies an ISO 8601 timer string: R... -> cycle, P... -> duration, else date (an unknown override is E_INVALID_VALUE). */
  private static classifyTimer(value: string, override?: string): TimerKind {
    if (override !== undefined) {
      if (!(TIMER_KINDS as ReadonlyArray<string>).includes(override)) {
        throw modelError('E_INVALID_VALUE', `Unknown timer kind "${override}"; use one of ${TIMER_KINDS.join(', ')}`, {
          candidates: [...TIMER_KINDS],
          hint: 'Drop --timer-kind to classify from the value (R... -> cycle, P... -> duration, else date).',
        });
      }
      return override as TimerKind;
    }
    const v = value.trim();
    if (/^R/i.test(v)) return 'cycle';
    if (/^P/i.test(v)) return 'duration';
    return 'date';
  }

  private static isRefTrigger(trigger: Trigger): trigger is RefTrigger {
    return trigger in REF_TRIGGERS;
  }

  private static isEventSubProcess(el: El | undefined): boolean {
    return !!el && is(el, 'bpmn:SubProcess') && !!el.get<boolean | undefined>('triggeredByEvent');
  }

  private expression(body: string): El {
    return this.doc.moddle.create('bpmn:FormalExpression', { body });
  }

  private buildDefinition(trigger: Exclude<Trigger, 'none'>, opts: TriggerOptions): El {
    const type = TRIGGER_TYPES[trigger];
    switch (trigger) {
      case 'timer': {
        const def = this.doc.moddle.create(type, {});
        if (opts.timer !== undefined) {
          const value = opts.timer.trim();
          if (!value) throw modelError('E_INVALID_VALUE', 'The timer value is empty', { hint: 'Use ISO 8601: PT5M (duration), R/PT1H (cycle) or 2030-01-01T00:00:00Z (date).' });
          def.set(TIMER_PROPS[EventDefinitions.classifyTimer(value, opts.timerKind)], this.expression(value));
        }
        return def;
      }
      case 'message':
        return this.doc.moddle.create(type, opts.message ? { messageRef: this.roots.ensure('bpmn:Message', opts.message).el } : {});
      case 'error':
        return this.doc.moddle.create(type, opts.error ? { errorRef: this.roots.ensure('bpmn:Error', opts.error, { errorCode: opts.errorCode }).el } : {});
      case 'signal':
        return this.doc.moddle.create(type, opts.signal ? { signalRef: this.roots.ensure('bpmn:Signal', opts.signal).el } : {});
      case 'escalation':
        return this.doc.moddle.create(
          type,
          opts.escalation ? { escalationRef: this.roots.ensure('bpmn:Escalation', opts.escalation, { escalationCode: opts.escalationCode }).el } : {},
        );
      case 'conditional': {
        if (opts.when !== undefined && !opts.when.trim()) {
          throw modelError('E_INVALID_VALUE', 'The condition expression is empty', { hint: "Quote expressions with single quotes, e.g. --when '${approved}'." });
        }
        return this.doc.moddle.create(type, opts.when ? { condition: this.expression(opts.when) } : {});
      }
      case 'link': {
        const name = opts.link ?? this.event.get<string | undefined>('name');
        return this.doc.moddle.create(type, name ? { name } : {});
      }
      default:
        return this.doc.moddle.create(type, {});
    }
  }

  /** Re-points the root reference when the named element differs (codes are applied to it as when creating). */
  private updateReference(def: El, trigger: RefTrigger, opts: TriggerOptions): void {
    const spec = REF_TRIGGERS[trigger];
    const name = opts[trigger];
    if (name === undefined) return;
    const extra = spec.code ? { [spec.code]: opts[spec.code] } : {};
    const { el } = this.roots.ensure(spec.type, name, extra);
    if (def.get<El | undefined>(spec.prop) !== el) def.set(spec.prop, el);
  }

  /** Sets the body of an expression property, keeping an existing expression element (id, language, vendor attributes). */
  private updateExpression(def: El, prop: string, body: string, from: string = prop): void {
    const expr = def.get<El | undefined>(from);
    if (!expr) {
      def.set(prop, this.expression(body));
      return;
    }
    if (from !== prop) {
      def.set(from, undefined);
      def.set(prop, expr);
      expr.$parent = def;
    }
    if (expr.get<string | undefined>('body') !== body) expr.set('body', body);
  }

  private updateTimer(def: El, opts: TriggerOptions): void {
    if (opts.timer === undefined) return;
    const value = opts.timer.trim();
    if (!value) throw modelError('E_INVALID_VALUE', 'The timer value is empty', { hint: 'Use ISO 8601: PT5M (duration), R/PT1H (cycle) or 2030-01-01T00:00:00Z (date).' });
    const prop = TIMER_PROPS[EventDefinitions.classifyTimer(value, opts.timerKind)];
    const current = Object.values(TIMER_PROPS).find((p) => def.get<El | undefined>(p)) ?? prop;
    this.updateExpression(def, prop, value, current);
    for (const p of Object.values(TIMER_PROPS)) if (p !== prop && def.get<El | undefined>(p)) def.set(p, undefined);
  }

  /**
   * A new inline condition of a conditional event: like a sequence flow's
   * condition (ops/PropertySetter.ts), it replaces a script resource (camunda:resource and
   * its language go) and a `${...}` body does not keep a script language; both
   * are reported (W_PROPERTY_DROPPED).
   */
  private updateCondition(def: El, opts: TriggerOptions): Warning[] {
    if (opts.when === undefined) return [];
    if (!opts.when.trim()) {
      throw modelError('E_INVALID_VALUE', 'The condition expression is empty', { hint: "Quote expressions with single quotes, e.g. --when '${approved}'." });
    }
    const expr = def.get<El | undefined>('condition');
    const dropped: string[] = [];
    if (expr && expr.get<string | undefined>('body') !== opts.when) {
      const resourceKey = Object.keys(expr.$attrs ?? {}).find((k) => /^[^:]+:resource$/.test(k) && CAMUNDA.reads(this.doc.namespaceUri(k.split(':')[0]!)));
      const language = expr.get<string | undefined>('language');
      if (resourceKey) {
        dropped.push(`${resourceKey} ${String(expr.$attrs[resourceKey])}`);
        delete expr.$attrs[resourceKey];
      }
      if (language && (resourceKey || (/^\s*[$#]\{[\s\S]*\}\s*$/.test(opts.when) && language.toLowerCase() !== 'juel'))) {
        dropped.push(`language ${language}`);
        expr.set('language', undefined);
      }
    }
    this.updateExpression(def, 'condition', opts.when);
    if (!dropped.length) return [];
    return [
      {
        code: 'W_PROPERTY_DROPPED',
        message: `${dropped.join(' and ')} of the condition of ${idOf(this.event)} ${dropped.length > 1 ? 'were' : 'was'} dropped: the new inline condition replaces ${dropped[0]!.startsWith('language') ? 'the script' : 'the script resource'}`,
        element: idOf(this.event),
        hint: 'To keep a script condition set condition.camunda:resource=<uri> or condition.language=<lang> after when=.',
      },
    ];
  }

  /** Applies the trigger options to an existing definition of the same trigger, touching only what differs. */
  private updateDefinition(def: El, trigger: Exclude<Trigger, 'none'>, opts: TriggerOptions): Warning[] {
    if (EventDefinitions.isRefTrigger(trigger)) this.updateReference(def, trigger, opts);
    else if (trigger === 'timer') this.updateTimer(def, opts);
    else if (trigger === 'conditional') return this.updateCondition(def, opts);
    else if (trigger === 'link' && opts.link !== undefined && def.get<string | undefined>('name') !== opts.link) def.set('name', opts.link || undefined);
    return [];
  }

  /** Removes the event's definitions (ids released) and reports the vendor content that goes with them. */
  private dropDefinitions(trigger: Trigger): Warning[] {
    const defs = [...(this.event.get<El[] | undefined>('eventDefinitions') ?? [])];
    this.event.set('eventDefinitions', undefined);
    const warnings: Warning[] = [];
    for (const def of defs) {
      for (const e of walk(def, { bpmnOnly: true })) {
        const id = e.get<string | undefined>('id');
        if (id) this.doc.ids.release(id);
      }
      const lost = vendorContent(def);
      if (!lost.length) continue;
      const defId = def.get<string | undefined>('id');
      warnings.push({
        code: 'W_PROPERTY_DROPPED',
        message: `${lost.join(', ')} of the ${def.$type.replace('bpmn:', '')}${defId ? ` ${defId}` : ''} of ${idOf(this.event)} ${lost.length > 1 ? 'were' : 'was'} dropped: the trigger changed to ${trigger}`,
        element: idOf(this.event),
        hint: 'Vendor attributes and extension elements belong to the old event definition; re-create what the new trigger still needs in the XML, or keep the old trigger and change only its details (e.g. `bpmn set <file> <id> message=<Name>`).',
      });
    }
    return warnings;
  }

  /**
   * An event with several event definitions set to the trigger of one of them:
   * that one stays (id, details and vendor content), the others go (ids
   * released), reported as one W_PROPERTY_DROPPED.
   */
  private dropOtherDefinitions(keep: El, trigger: Trigger): Warning[] {
    const defs = [...(this.event.get<El[] | undefined>('eventDefinitions') ?? [])];
    const others = defs.filter((d) => d !== keep);
    this.event.set('eventDefinitions', [keep]);
    for (const def of others) {
      for (const e of walk(def, { bpmnOnly: true })) {
        const id = e.get<string | undefined>('id');
        if (id) this.doc.ids.release(id);
      }
    }
    const text = (d: El): string => {
      const local = d.$type.replace('bpmn:', '');
      const id = d.get<string | undefined>('id');
      const lost = vendorContent(d);
      return `${local.charAt(0).toLowerCase()}${local.slice(1)}${id ? ` ${id}` : ''}${lost.length ? ` (with ${lost.join(', ')})` : ''}`;
    };
    return [
      {
        code: 'W_PROPERTY_DROPPED',
        message: `${others.map(text).join(', ')} of ${idOf(this.event)} ${others.length > 1 ? 'were' : 'was'} dropped: trigger=${trigger} keeps only its ${text(keep).replace(/ \(with .*\)$/, '')} (an event acts on one event definition)`,
        element: idOf(this.event),
        hint: 'Set the trigger of the definition the event should keep; the others cannot be kept on the same event.',
      },
    ];
  }

  private applyInterrupting(trigger: Trigger, opts: TriggerOptions): void {
    const want = opts.nonInterrupting;
    const interruptingOnly = ALWAYS_INTERRUPTING.includes(trigger);
    if (is(this.event, 'bpmn:BoundaryEvent')) {
      if (want === true) {
        if (interruptingOnly) {
          throw modelError('E_INVALID_TRIGGER', `A ${trigger} boundary event cannot be non-interrupting`, {
            element: idOf(this.event),
            hint: 'Only message, timer, signal, escalation and conditional boundary events can be non-interrupting.',
          });
        }
        this.event.set('cancelActivity', false);
      } else if (want === false || (interruptingOnly && this.event.get<boolean>('cancelActivity') === false)) {
        this.event.set('cancelActivity', undefined);
      }
      return;
    }
    if (is(this.event, 'bpmn:StartEvent')) {
      if (want === true) {
        if (!EventDefinitions.isEventSubProcess(this.doc.scopeOf(this.event))) {
          throw modelError('E_INVALID_TRIGGER', `Start event ${idOf(this.event)} is not inside an event sub-process and cannot be non-interrupting`, {
            element: idOf(this.event),
            hint: 'Only start events of an eventSubProcess can be non-interrupting.',
          });
        }
        if (interruptingOnly || trigger === 'none') {
          throw modelError('E_INVALID_TRIGGER', `A ${trigger} start event cannot be non-interrupting`, {
            element: idOf(this.event),
            hint: 'Only message, timer, signal, escalation and conditional start events can be non-interrupting.',
          });
        }
        this.event.set('isInterrupting', false);
      } else if (want === false || (interruptingOnly && this.event.get<boolean>('isInterrupting') === false)) {
        this.event.set('isInterrupting', undefined);
      }
      return;
    }
    if (want === true) {
      throw modelError('E_INVALID_TRIGGER', `nonInterrupting only applies to boundary events and event sub-process start events (${idOf(this.event)} is a ${kindOf(this.event)?.kind ?? this.event.$type})`, {
        element: idOf(this.event),
      });
    }
  }
}
