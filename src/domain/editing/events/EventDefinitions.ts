import type { EditSession } from '../../document/EditSession.js';
import { modelError } from '../../document/utils/errors.js';
import type { Finding } from '../../document/Finding.js';
import { isEventSubProcess, kindOf, TRIGGERS, type Trigger } from '../../document/Kinds.js';
import { addTo, is, walk, type El, idOf } from '../../document/utils/moddle.js';
import { Camunda8Defaults } from '../../document/vendor/Camunda8Defaults.js';
import { CAMUNDA } from '../../document/vendor/CamundaDescriptor.js';
import type { TriggerOptions } from '../../commands/types.js';
import { vendorContent } from '../../document/utils/elements.js';
import { ALWAYS_INTERRUPTING, TIMER_PROPS } from './EventTrigger.js';
import { RootElements, type RootRefType } from './RootElements.js';

const EVENT_SUBPROCESS_ONLY: Trigger[] = ['error', 'escalation', 'compensate'];

const TIMER_KINDS = ['cycle', 'duration', 'date'] as const;
type TimerKind = (typeof TIMER_KINDS)[number];

type RefTrigger = 'message' | 'error' | 'signal' | 'escalation';

const REF_TRIGGERS: Record<RefTrigger, { prop: string; type: RootRefType; code?: 'errorCode' | 'escalationCode' }> = {
  message: { prop: 'messageRef', type: 'bpmn:Message' },
  error: { prop: 'errorRef', type: 'bpmn:Error', code: 'errorCode' },
  signal: { prop: 'signalRef', type: 'bpmn:Signal' },
  escalation: { prop: 'escalationRef', type: 'bpmn:Escalation', code: 'escalationCode' },
};

/**
 * Sets an event's trigger through its event definitions. A definition of the same trigger is
 * updated in place, so its id, vendor attributes and extension elements survive; a trigger
 * change replaces the definitions and reports the vendor content that goes.
 */
export class EventDefinitions {
  constructor(private readonly edit: EditSession) {}

  /**
   * Sets the trigger of the event, keeping its one definition of that trigger and dropping the
   * others. Returns the warnings about vendor content a swap dropped.
   */
  setTrigger(event: El, trigger: Trigger, opts: TriggerOptions = {}): Finding[] {
    if (!is(event, 'bpmn:Event')) {
      throw modelError('E_WRONG_KIND', `${idOf(event)} is not an event and cannot have a trigger`, { element: idOf(event) });
    }
    const def = kindOf(event);
    const allowed = def?.triggers ?? [];
    if (!def || !allowed.includes(trigger)) {
      throw modelError('E_INVALID_TRIGGER', `Trigger "${trigger}" is not allowed on ${def?.kind ?? event.$type}. Allowed: ${allowed.join(', ')}`, {
        element: idOf(event),
        candidates: allowed,
      });
    }
    if (is(event, 'bpmn:StartEvent') && EVENT_SUBPROCESS_ONLY.includes(trigger) && !isEventSubProcess(this.edit.doc.scopeOf(event))) {
      throw modelError('E_INVALID_TRIGGER', `A startEvent:${trigger} is only allowed inside an event sub-process (${idOf(event)} is not)`, {
        element: idOf(event),
        hint: `Create the event sub-process together with its start in one command: \`add eventSubProcess "Handle errors" --${trigger === 'compensate' ? 'error <Name>' : `${trigger} <Name>`}\` (or eventSubProcess:${trigger}); or add the start with --in <eventSubProcessId> in the same \`apply\` batch as the eventSubProcess.`,
      });
    }
    this.applyInterrupting(event, trigger, opts);
    const defs = event.get<El[] | undefined>('eventDefinitions') ?? [];
    const matching = trigger !== 'none' ? defs.filter((definition) => is(definition, TRIGGERS[trigger].definition)) : [];
    const same = matching.length === 1 ? matching[0] : undefined;
    if (same && trigger !== 'none') {
      const others = defs.length > 1 ? this.dropOtherDefinitions(event, same, trigger) : [];
      const warnings = this.updateDefinition(event, same, trigger, opts);
      this.edit.doc.invalidate();
      return [...others, ...warnings];
    }
    const fresh = trigger !== 'none' ? this.buildDefinition(event, trigger, opts) : undefined;
    const warnings = this.dropDefinitions(event, trigger);
    if (fresh) {
      addTo(event, 'eventDefinitions', fresh);
      new Camunda8Defaults(this.edit).definitionId(event, fresh);
    }
    this.edit.doc.invalidate();
    return warnings;
  }

  /** ISO 8601: R... is a cycle, P... a duration, anything else a date. */
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
    const trimmed = value.trim();
    if (/^R/i.test(trimmed)) return 'cycle';
    if (/^P/i.test(trimmed)) return 'duration';
    return 'date';
  }

  private static isRefTrigger(trigger: Trigger): trigger is RefTrigger {
    return trigger in REF_TRIGGERS;
  }

  private expression(body: string): El {
    return this.edit.doc.moddle.create('bpmn:FormalExpression', { body });
  }

  private buildDefinition(event: El, trigger: Exclude<Trigger, 'none'>, opts: TriggerOptions): El {
    const type = TRIGGERS[trigger].definition;
    switch (trigger) {
      case 'timer': {
        const def = this.edit.doc.moddle.create(type, {});
        if (opts.timer !== undefined) {
          const value = opts.timer.trim();
          if (!value) throw modelError('E_INVALID_VALUE', 'The timer value is empty', { hint: 'Use ISO 8601: PT5M (duration), R/PT1H (cycle) or 2030-01-01T00:00:00Z (date).' });
          def.set(TIMER_PROPS[EventDefinitions.classifyTimer(value, opts.timerKind)], this.expression(value));
        }
        return def;
      }
      case 'message':
        return this.edit.doc.moddle.create(type, opts.message ? { messageRef: new RootElements(this.edit).ensure('bpmn:Message', opts.message).el } : {});
      case 'error':
        return this.edit.doc.moddle.create(type, opts.error ? { errorRef: new RootElements(this.edit).ensure('bpmn:Error', opts.error, { errorCode: opts.errorCode }).el } : {});
      case 'signal':
        return this.edit.doc.moddle.create(type, opts.signal ? { signalRef: new RootElements(this.edit).ensure('bpmn:Signal', opts.signal).el } : {});
      case 'escalation':
        return this.edit.doc.moddle.create(
          type,
          opts.escalation ? { escalationRef: new RootElements(this.edit).ensure('bpmn:Escalation', opts.escalation, { escalationCode: opts.escalationCode }).el } : {},
        );
      case 'conditional': {
        if (opts.when !== undefined && !opts.when.trim()) {
          throw modelError('E_INVALID_VALUE', 'The condition expression is empty', { hint: "Quote expressions with single quotes, e.g. --when '${approved}'." });
        }
        return this.edit.doc.moddle.create(type, opts.when ? { condition: this.expression(opts.when) } : {});
      }
      case 'link': {
        const name = opts.link ?? event.get<string | undefined>('name');
        return this.edit.doc.moddle.create(type, name ? { name } : {});
      }
      default:
        return this.edit.doc.moddle.create(type, {});
    }
  }

  private updateReference(def: El, trigger: RefTrigger, opts: TriggerOptions): void {
    const spec = REF_TRIGGERS[trigger];
    const name = opts[trigger];
    if (name === undefined) return;
    const extra = spec.code ? { [spec.code]: opts[spec.code] } : {};
    const { el } = new RootElements(this.edit).ensure(spec.type, name, extra);
    if (def.get<El | undefined>(spec.prop) !== el) def.set(spec.prop, el);
  }

  /** Keeps an existing expression element with its id, language and vendor attributes. */
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
    const current = Object.values(TIMER_PROPS).find((timerProp) => def.get<El | undefined>(timerProp)) ?? prop;
    this.updateExpression(def, prop, value, current);
    for (const timerProp of Object.values(TIMER_PROPS)) if (timerProp !== prop && def.get<El | undefined>(timerProp)) def.set(timerProp, undefined);
  }

  /**
   * Like a sequence flow's condition: a new inline condition replaces a script resource,
   * and a `${...}` body does not keep a script language.
   */
  private updateCondition(event: El, def: El, opts: TriggerOptions): Finding[] {
    if (opts.when === undefined) return [];
    if (!opts.when.trim()) {
      throw modelError('E_INVALID_VALUE', 'The condition expression is empty', { hint: "Quote expressions with single quotes, e.g. --when '${approved}'." });
    }
    const expr = def.get<El | undefined>('condition');
    const dropped: string[] = [];
    if (expr && expr.get<string | undefined>('body') !== opts.when) {
      const resourceKey = Object.keys(expr.$attrs ?? {}).find((attrKey) => /^[^:]+:resource$/.test(attrKey) && CAMUNDA.reads(this.edit.doc.namespaceUri(attrKey.split(':')[0]!)));
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
        message: `${dropped.join(' and ')} of the condition of ${idOf(event)} ${dropped.length > 1 ? 'were' : 'was'} dropped: the new inline condition replaces ${dropped[0]!.startsWith('language') ? 'the script' : 'the script resource'}`,
        element: idOf(event),
        hint: 'To keep a script condition set condition.camunda:resource=<uri> or condition.language=<lang> after when=.',
      },
    ];
  }

  private updateDefinition(event: El, def: El, trigger: Exclude<Trigger, 'none'>, opts: TriggerOptions): Finding[] {
    if (EventDefinitions.isRefTrigger(trigger)) this.updateReference(def, trigger, opts);
    else if (trigger === 'timer') this.updateTimer(def, opts);
    else if (trigger === 'conditional') return this.updateCondition(event, def, opts);
    else if (trigger === 'link' && opts.link !== undefined && def.get<string | undefined>('name') !== opts.link) def.set('name', opts.link || undefined);
    return [];
  }

  private dropDefinitions(event: El, trigger: Trigger): Finding[] {
    const defs = [...(event.get<El[] | undefined>('eventDefinitions') ?? [])];
    event.set('eventDefinitions', undefined);
    const warnings: Finding[] = [];
    for (const def of defs) {
      for (const element of walk(def, { bpmnOnly: true })) {
        const id = element.get<string | undefined>('id');
        if (id) this.edit.doc.ids.release(id);
      }
      const lost = vendorContent(def);
      if (!lost.length) continue;
      const defId = def.get<string | undefined>('id');
      warnings.push({
        code: 'W_PROPERTY_DROPPED',
        message: `${lost.join(', ')} of the ${def.$type.replace('bpmn:', '')}${defId ? ` ${defId}` : ''} of ${idOf(event)} ${lost.length > 1 ? 'were' : 'was'} dropped: the trigger changed to ${trigger}`,
        element: idOf(event),
        hint: 'Vendor attributes and extension elements belong to the old event definition; re-create what the new trigger still needs in the XML, or keep the old trigger and change only its details (e.g. `bpmn set <file> <id> message=<Name>`).',
      });
    }
    return warnings;
  }

  private dropOtherDefinitions(event: El, keep: El, trigger: Trigger): Finding[] {
    const defs = [...(event.get<El[] | undefined>('eventDefinitions') ?? [])];
    const others = defs.filter((definition) => definition !== keep);
    event.set('eventDefinitions', [keep]);
    for (const def of others) {
      for (const element of walk(def, { bpmnOnly: true })) {
        const id = element.get<string | undefined>('id');
        if (id) this.edit.doc.ids.release(id);
      }
    }
    const text = (definition: El): string => {
      const local = definition.$type.replace('bpmn:', '');
      const id = definition.get<string | undefined>('id');
      const lost = vendorContent(definition);
      return `${local.charAt(0).toLowerCase()}${local.slice(1)}${id ? ` ${id}` : ''}${lost.length ? ` (with ${lost.join(', ')})` : ''}`;
    };
    return [
      {
        code: 'W_PROPERTY_DROPPED',
        message: `${others.map(text).join(', ')} of ${idOf(event)} ${others.length > 1 ? 'were' : 'was'} dropped: trigger=${trigger} keeps only its ${text(keep).replace(/ \(with .*\)$/, '')} (an event acts on one event definition)`,
        element: idOf(event),
        hint: 'Set the trigger of the definition the event should keep; the others cannot be kept on the same event.',
      },
    ];
  }

  private applyInterrupting(event: El, trigger: Trigger, opts: TriggerOptions): void {
    const want = opts.nonInterrupting;
    const interruptingOnly = ALWAYS_INTERRUPTING.includes(trigger);
    if (is(event, 'bpmn:BoundaryEvent')) {
      if (want === true) {
        if (interruptingOnly) {
          throw modelError('E_INVALID_TRIGGER', `A ${trigger} boundary event cannot be non-interrupting`, {
            element: idOf(event),
            hint: 'Only message, timer, signal, escalation and conditional boundary events can be non-interrupting.',
          });
        }
        event.set('cancelActivity', false);
      } else if (want === false || (interruptingOnly && event.get<boolean>('cancelActivity') === false)) {
        event.set('cancelActivity', undefined);
      }
      return;
    }
    if (is(event, 'bpmn:StartEvent')) {
      if (want === true) {
        if (!isEventSubProcess(this.edit.doc.scopeOf(event))) {
          throw modelError('E_INVALID_TRIGGER', `Start event ${idOf(event)} is not inside an event sub-process and cannot be non-interrupting`, {
            element: idOf(event),
            hint: 'Only start events of an eventSubProcess can be non-interrupting.',
          });
        }
        if (interruptingOnly || trigger === 'none') {
          throw modelError('E_INVALID_TRIGGER', `A ${trigger} start event cannot be non-interrupting`, {
            element: idOf(event),
            hint: 'Only message, timer, signal, escalation and conditional start events can be non-interrupting.',
          });
        }
        event.set('isInterrupting', false);
      } else if (want === false || (interruptingOnly && event.get<boolean>('isInterrupting') === false)) {
        event.set('isInterrupting', undefined);
      }
      return;
    }
    if (want === true) {
      throw modelError('E_INVALID_TRIGGER', `nonInterrupting only applies to boundary events and event sub-process start events (${idOf(event)} is a ${kindOf(event)?.kind ?? event.$type})`, {
        element: idOf(event),
      });
    }
  }
}
