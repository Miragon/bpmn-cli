import { type BpmnElement, BpmnError, CAMUNDA, ElementText, ElementWalk, EventTrigger, type Finding, Kinds, type Trigger, type TriggerOptions, Triggers } from '../../model/index.js';
import type { EditSession } from '../session/EditSession.js';
import { Camunda8Defaults } from './Camunda8Defaults.js';
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

export class EventDefinitions {
  constructor(private readonly edit: EditSession) {}

  setTrigger(event: BpmnElement, trigger: Trigger, opts: TriggerOptions = {}): Finding[] {
    if (!event.is('bpmn:Event')) {
      throw BpmnError.model('E_WRONG_KIND', `${event.id} is not an event and cannot have a trigger`, { element: event.id });
    }
    const def = Kinds.of(event);
    const allowed = def?.triggers ?? [];
    if (!def || !allowed.includes(trigger)) {
      throw BpmnError.model('E_INVALID_TRIGGER', `Trigger "${trigger}" is not allowed on ${def?.kind ?? event.type}. Allowed: ${allowed.join(', ')}`, {
        element: event.id,
        candidates: allowed,
      });
    }
    if (event.is('bpmn:StartEvent') && EVENT_SUBPROCESS_ONLY.includes(trigger) && !Kinds.isEventSubProcess(this.edit.document.scopes.scopeOf(event))) {
      throw BpmnError.model('E_INVALID_TRIGGER', `A startEvent:${trigger} is only allowed inside an event sub-process (${event.id} is not)`, {
        element: event.id,
        hint: `Create the event sub-process together with its start in one command: \`add eventSubProcess "Handle errors" --${trigger === 'compensate' ? 'error <Name>' : `${trigger} <Name>`}\` (or eventSubProcess:${trigger}); or add the start with --in <eventSubProcessId> in the same \`apply\` batch as the eventSubProcess.`,
      });
    }
    this.applyInterrupting(event, trigger, opts);
    const defs = event.get<BpmnElement[] | undefined>('eventDefinitions') ?? [];
    const matching = trigger !== 'none' ? defs.filter((definition) => definition.is(Triggers.TABLE[trigger].definition)) : [];
    const same = matching.length === 1 ? matching[0] : undefined;
    if (same && trigger !== 'none') {
      const others = defs.length > 1 ? this.dropOtherDefinitions(event, same, trigger) : [];
      const warnings = this.updateDefinition(event, same, trigger, opts);
      this.edit.document.tree.invalidate();
      return [...others, ...warnings];
    }
    const fresh = trigger !== 'none' ? this.buildDefinition(event, trigger, opts) : undefined;
    const warnings = this.dropDefinitions(event, trigger);
    if (fresh) {
      event.add('eventDefinitions', fresh);
      new Camunda8Defaults(this.edit).definitionId(event, fresh);
    }
    this.edit.document.tree.invalidate();
    return warnings;
  }

  private static classifyTimer(value: string, override?: string): TimerKind {
    if (override !== undefined) {
      if (!(TIMER_KINDS as ReadonlyArray<string>).includes(override)) {
        throw BpmnError.model('E_INVALID_VALUE', `Unknown timer kind "${override}"; use one of ${TIMER_KINDS.join(', ')}`, {
          candidates: [...TIMER_KINDS],
          hint: 'Drop --timer-kind to classify from the value (R... -> cycle, P... -> duration, else date).',
        });
      }
      return override as TimerKind;
    }
    const trimmed = value.trim();
    if (/^R/i.test(trimmed)) {
      return 'cycle';
    }
    if (/^P/i.test(trimmed)) {
      return 'duration';
    }
    return 'date';
  }

  private static isRefTrigger(trigger: Trigger): trigger is RefTrigger {
    return trigger in REF_TRIGGERS;
  }

  private expression(body: string): BpmnElement {
    return this.edit.document.tree.build('bpmn:FormalExpression', { body });
  }

  private buildDefinition(event: BpmnElement, trigger: Exclude<Trigger, 'none'>, opts: TriggerOptions): BpmnElement {
    const type = Triggers.TABLE[trigger].definition;
    switch (trigger) {
      case 'timer': {
        const def = this.edit.document.tree.build(type, {});
        if (opts.timer !== undefined) {
          const value = opts.timer.trim();
          if (!value) {
            throw BpmnError.model('E_INVALID_VALUE', 'The timer value is empty', { hint: 'Use ISO 8601: PT5M (duration), R/PT1H (cycle) or 2030-01-01T00:00:00Z (date).' });
          }
          def.set(EventTrigger.TIMER_PROPS[EventDefinitions.classifyTimer(value, opts.timerKind)], this.expression(value));
        }
        return def;
      }
      case 'message':
        return this.edit.document.tree.build(type, opts.message ? { messageRef: new RootElements(this.edit).ensure('bpmn:Message', opts.message).el } : {});
      case 'error':
        return this.edit.document.tree.build(type, opts.error ? { errorRef: new RootElements(this.edit).ensure('bpmn:Error', opts.error, { errorCode: opts.errorCode }).el } : {});
      case 'signal':
        return this.edit.document.tree.build(type, opts.signal ? { signalRef: new RootElements(this.edit).ensure('bpmn:Signal', opts.signal).el } : {});
      case 'escalation':
        return this.edit.document.tree.build(
          type,
          opts.escalation ? { escalationRef: new RootElements(this.edit).ensure('bpmn:Escalation', opts.escalation, { escalationCode: opts.escalationCode }).el } : {},
        );
      case 'conditional': {
        if (opts.when !== undefined && !opts.when.trim()) {
          throw BpmnError.model('E_INVALID_VALUE', 'The condition expression is empty', { hint: "Quote expressions with single quotes, e.g. --when '${approved}'." });
        }
        return this.edit.document.tree.build(type, opts.when ? { condition: this.expression(opts.when) } : {});
      }
      case 'link': {
        const name = opts.link ?? event.get<string | undefined>('name');
        return this.edit.document.tree.build(type, name ? { name } : {});
      }
      default:
        return this.edit.document.tree.build(type, {});
    }
  }

  private updateReference(def: BpmnElement, trigger: RefTrigger, opts: TriggerOptions): void {
    const spec = REF_TRIGGERS[trigger];
    const name = opts[trigger];
    if (name === undefined) {
      return;
    }
    const extra = spec.code ? { [spec.code]: opts[spec.code] } : {};
    const { el } = new RootElements(this.edit).ensure(spec.type, name, extra);
    if (def.get<BpmnElement | undefined>(spec.prop) !== el) {
      def.set(spec.prop, el);
    }
  }

  private updateExpression(def: BpmnElement, prop: string, body: string, from: string = prop): void {
    const expr = def.get<BpmnElement | undefined>(from);
    if (!expr) {
      def.set(prop, this.expression(body));
      return;
    }
    if (from !== prop) {
      def.set(from, undefined);
      def.set(prop, expr);
      expr.parent = def;
    }
    if (expr.get<string | undefined>('body') !== body) {
      expr.set('body', body);
    }
  }

  private updateTimer(def: BpmnElement, opts: TriggerOptions): void {
    if (opts.timer === undefined) {
      return;
    }
    const value = opts.timer.trim();
    if (!value) {
      throw BpmnError.model('E_INVALID_VALUE', 'The timer value is empty', { hint: 'Use ISO 8601: PT5M (duration), R/PT1H (cycle) or 2030-01-01T00:00:00Z (date).' });
    }
    const prop = EventTrigger.TIMER_PROPS[EventDefinitions.classifyTimer(value, opts.timerKind)];
    const current = Object.values(EventTrigger.TIMER_PROPS).find((timerProp) => def.get<BpmnElement | undefined>(timerProp)) ?? prop;
    this.updateExpression(def, prop, value, current);
    for (const timerProp of Object.values(EventTrigger.TIMER_PROPS)) {
      if (timerProp !== prop && def.get<BpmnElement | undefined>(timerProp)) {
        def.set(timerProp, undefined);
      }
    }
  }

  private updateCondition(event: BpmnElement, def: BpmnElement, opts: TriggerOptions): Finding[] {
    if (opts.when === undefined) {
      return [];
    }
    if (!opts.when.trim()) {
      throw BpmnError.model('E_INVALID_VALUE', 'The condition expression is empty', { hint: "Quote expressions with single quotes, e.g. --when '${approved}'." });
    }
    const expr = def.get<BpmnElement | undefined>('condition');
    const dropped: string[] = [];
    if (expr && expr.get<string | undefined>('body') !== opts.when) {
      const resourceKey = Object.keys(expr.attrs ?? {}).find((attrKey) => /^[^:]+:resource$/.test(attrKey) && CAMUNDA.reads(this.edit.document.namespaces.uriOf(attrKey.split(':')[0]!)));
      const language = expr.get<string | undefined>('language');
      if (resourceKey) {
        dropped.push(`${resourceKey} ${String(expr.attrs[resourceKey])}`);
        delete expr.attrs[resourceKey];
      }
      if (language && (resourceKey || (/^\s*[$#]\{[\s\S]*\}\s*$/.test(opts.when) && language.toLowerCase() !== 'juel'))) {
        dropped.push(`language ${language}`);
        expr.set('language', undefined);
      }
    }
    this.updateExpression(def, 'condition', opts.when);
    if (!dropped.length) {
      return [];
    }
    return [
      {
        code: 'W_PROPERTY_DROPPED',
        message: `${dropped.join(' and ')} of the condition of ${event.id} ${dropped.length > 1 ? 'were' : 'was'} dropped: the new inline condition replaces ${dropped[0]!.startsWith('language') ? 'the script' : 'the script resource'}`,
        element: event.id,
        hint: 'To keep a script condition set condition.camunda:resource=<uri> or condition.language=<lang> after when=.',
      },
    ];
  }

  private updateDefinition(event: BpmnElement, def: BpmnElement, trigger: Exclude<Trigger, 'none'>, opts: TriggerOptions): Finding[] {
    if (EventDefinitions.isRefTrigger(trigger)) {
      this.updateReference(def, trigger, opts);
    } else if (trigger === 'timer') {
      this.updateTimer(def, opts);
    } else if (trigger === 'conditional') {
      return this.updateCondition(event, def, opts);
    } else if (trigger === 'link' && opts.link !== undefined && def.get<string | undefined>('name') !== opts.link) {
      def.set('name', opts.link || undefined);
    }
    return [];
  }

  private dropDefinitions(event: BpmnElement, trigger: Trigger): Finding[] {
    const defs = [...(event.get<BpmnElement[] | undefined>('eventDefinitions') ?? [])];
    event.set('eventDefinitions', undefined);
    const warnings: Finding[] = [];
    for (const def of defs) {
      for (const element of new ElementWalk(def).depthFirst({ bpmnOnly: true })) {
        const id = element.get<string | undefined>('id');
        if (id) {
          this.edit.document.ids.registry.release(id);
        }
      }
      const lost = ElementText.vendorContent(def);
      if (!lost.length) {
        continue;
      }
      const defId = def.get<string | undefined>('id');
      warnings.push({
        code: 'W_PROPERTY_DROPPED',
        message: `${lost.join(', ')} of the ${def.type.replace('bpmn:', '')}${defId ? ` ${defId}` : ''} of ${event.id} ${lost.length > 1 ? 'were' : 'was'} dropped: the trigger changed to ${trigger}`,
        element: event.id,
        hint: 'Vendor attributes and extension elements belong to the old event definition; re-create what the new trigger still needs in the XML, or keep the old trigger and change only its details (e.g. `bpmn set <file> <id> message=<Name>`).',
      });
    }
    return warnings;
  }

  private dropOtherDefinitions(event: BpmnElement, keep: BpmnElement, trigger: Trigger): Finding[] {
    const defs = [...(event.get<BpmnElement[] | undefined>('eventDefinitions') ?? [])];
    const others = defs.filter((definition) => definition !== keep);
    event.set('eventDefinitions', [keep]);
    for (const def of others) {
      for (const element of new ElementWalk(def).depthFirst({ bpmnOnly: true })) {
        const id = element.get<string | undefined>('id');
        if (id) {
          this.edit.document.ids.registry.release(id);
        }
      }
    }
    const text = (definition: BpmnElement): string => {
      const local = definition.type.replace('bpmn:', '');
      const id = definition.get<string | undefined>('id');
      const lost = ElementText.vendorContent(definition);
      return `${local.charAt(0).toLowerCase()}${local.slice(1)}${id ? ` ${id}` : ''}${lost.length ? ` (with ${lost.join(', ')})` : ''}`;
    };
    return [
      {
        code: 'W_PROPERTY_DROPPED',
        message: `${others.map(text).join(', ')} of ${event.id} ${others.length > 1 ? 'were' : 'was'} dropped: trigger=${trigger} keeps only its ${text(keep).replace(/ \(with .*\)$/, '')} (an event acts on one event definition)`,
        element: event.id,
        hint: 'Set the trigger of the definition the event should keep; the others cannot be kept on the same event.',
      },
    ];
  }

  private applyInterrupting(event: BpmnElement, trigger: Trigger, opts: TriggerOptions): void {
    const want = opts.nonInterrupting;
    const interruptingOnly = EventTrigger.ALWAYS_INTERRUPTING.includes(trigger);
    if (event.is('bpmn:BoundaryEvent')) {
      if (want === true) {
        if (interruptingOnly) {
          throw BpmnError.model('E_INVALID_TRIGGER', `A ${trigger} boundary event cannot be non-interrupting`, {
            element: event.id,
            hint: 'Only message, timer, signal, escalation and conditional boundary events can be non-interrupting.',
          });
        }
        event.set('cancelActivity', false);
      } else if (want === false || (interruptingOnly && event.get<boolean>('cancelActivity') === false)) {
        event.set('cancelActivity', undefined);
      }
      return;
    }
    if (event.is('bpmn:StartEvent')) {
      if (want === true) {
        if (!Kinds.isEventSubProcess(this.edit.document.scopes.scopeOf(event))) {
          throw BpmnError.model('E_INVALID_TRIGGER', `Start event ${event.id} is not inside an event sub-process and cannot be non-interrupting`, {
            element: event.id,
            hint: 'Only start events of an eventSubProcess can be non-interrupting.',
          });
        }
        if (interruptingOnly || trigger === 'none') {
          throw BpmnError.model('E_INVALID_TRIGGER', `A ${trigger} start event cannot be non-interrupting`, {
            element: event.id,
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
      throw BpmnError.model('E_INVALID_TRIGGER', `nonInterrupting only applies to boundary events and event sub-process start events (${event.id} is a ${Kinds.of(event)?.kind ?? event.type})`, {
        element: event.id,
      });
    }
  }
}
