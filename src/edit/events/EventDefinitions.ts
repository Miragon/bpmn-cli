import { type BpmnElement, BpmnError, type DefinedTrigger, EventTrigger, type Finding, Kinds, type Trigger, type TriggerOptions, Triggers } from '../../model/index.js';
import { PropertyCoercer } from '../properties/PropertyCoercer.js';
import type { EditSession } from '../session/EditSession.js';
import { Camunda8Defaults } from './Camunda8Defaults.js';
import { DefinitionRemoval } from './DefinitionRemoval.js';
import { InterruptingFlag } from './InterruptingFlag.js';
import { RootElements, type RootRefType } from './RootElements.js';

type TimerKind = 'cycle' | 'duration' | 'date';

type RefTrigger = 'message' | 'error' | 'signal' | 'escalation';

export class EventDefinitions {
  private static readonly EVENT_SUBPROCESS_ONLY: Trigger[] = ['error', 'escalation', 'compensate'];
  private static readonly TIMER_KINDS: readonly TimerKind[] = ['cycle', 'duration', 'date'];
  private static readonly REF_TRIGGERS: Record<RefTrigger, { prop: string; type: RootRefType; code?: 'errorCode' | 'escalationCode' }> = {
    message: { prop: 'messageRef', type: 'bpmn:Message' },
    error: { prop: 'errorRef', type: 'bpmn:Error', code: 'errorCode' },
    signal: { prop: 'signalRef', type: 'bpmn:Signal' },
    escalation: { prop: 'escalationRef', type: 'bpmn:Escalation', code: 'escalationCode' },
  };

  constructor(private readonly edit: EditSession) {}

  setTrigger(event: BpmnElement, trigger: Trigger, opts: TriggerOptions = {}): Finding[] {
    this.assertTriggerAllowed(event, trigger);
    new InterruptingFlag(this.edit).apply(event, trigger, opts);
    const warnings = trigger === 'none' ? new DefinitionRemoval(this.edit).dropAll(event, trigger) : this.define(event, trigger, opts);
    this.edit.document.tree.invalidate();
    return warnings;
  }

  private define(event: BpmnElement, trigger: DefinedTrigger, opts: TriggerOptions): Finding[] {
    const defs = event.list('eventDefinitions');
    const [same, ...more] = defs.filter((definition) => definition.is(Triggers.TABLE[trigger].definition));
    if (same && !more.length) {
      const others = defs.length > 1 ? new DefinitionRemoval(this.edit).dropOthers(event, same, trigger) : [];
      return [...others, ...this.updateDefinition(event, same, trigger, opts)];
    }
    const fresh = this.buildDefinition(event, trigger, opts);
    const warnings = new DefinitionRemoval(this.edit).dropAll(event, trigger);
    event.add('eventDefinitions', fresh);
    new Camunda8Defaults(this.edit).definitionId(event, fresh);
    return warnings;
  }

  private assertTriggerAllowed(event: BpmnElement, trigger: Trigger): void {
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
    if (event.is('bpmn:StartEvent') && EventDefinitions.EVENT_SUBPROCESS_ONLY.includes(trigger) && !Kinds.isEventSubProcess(this.edit.document.scopes.scopeOf(event))) {
      throw BpmnError.model('E_INVALID_TRIGGER', `A startEvent:${trigger} is only allowed inside an event sub-process (${event.id} is not)`, {
        element: event.id,
        hint: `Create the event sub-process together with its start in one command: \`bpmn add <file> eventSubProcess:${trigger} "Handle errors"\`; or add the start with --in <eventSubProcessId> in the same \`apply\` batch as the eventSubProcess.`,
      });
    }
  }

  private static classifyTimer(value: string, override?: string): TimerKind {
    if (override !== undefined) {
      if (!(EventDefinitions.TIMER_KINDS as ReadonlyArray<string>).includes(override)) {
        throw BpmnError.model('E_INVALID_VALUE', `Unknown timer kind "${override}"; use one of ${EventDefinitions.TIMER_KINDS.join(', ')}`, {
          candidates: [...EventDefinitions.TIMER_KINDS],
          hint: 'The value tells the kind: R... -> cycle, P... -> duration, else date.',
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

  private static rootName(trigger: RefTrigger, opts: TriggerOptions): string | undefined {
    const { code } = EventDefinitions.REF_TRIGGERS[trigger];
    return opts[trigger] ?? (code && opts[code]);
  }

  private static isRefTrigger(trigger: Trigger): trigger is RefTrigger {
    return trigger in EventDefinitions.REF_TRIGGERS;
  }

  private expression(body: string): BpmnElement {
    return this.edit.document.tree.build('bpmn:FormalExpression', { body });
  }

  private buildDefinition(event: BpmnElement, trigger: DefinedTrigger, opts: TriggerOptions): BpmnElement {
    const { tree } = this.edit.document;
    const type = Triggers.TABLE[trigger].definition;
    if (EventDefinitions.isRefTrigger(trigger)) {
      const name = EventDefinitions.rootName(trigger, opts);
      return tree.build(type, name ? { [EventDefinitions.REF_TRIGGERS[trigger].prop]: this.rootElement(trigger, name, opts) } : {});
    }
    switch (trigger) {
      case 'timer':
        return this.buildTimer(type, opts);
      case 'conditional':
        return this.buildConditional(type, opts);
      case 'link': {
        const name = opts.link ?? event.get<string | undefined>('name');
        return tree.build(type, name ? { name } : {});
      }
      default:
        return tree.build(type, {});
    }
  }

  private buildTimer(type: string, opts: TriggerOptions): BpmnElement {
    const def = this.edit.document.tree.build(type, {});
    if (opts.timer !== undefined) {
      const value = EventDefinitions.timerValue(opts.timer);
      def.set(EventTrigger.TIMER_PROPS[EventDefinitions.classifyTimer(value, opts.timerKind)], this.expression(value));
    }
    return def;
  }

  private static timerValue(timer: string): string {
    const value = timer.trim();
    if (!value) {
      throw BpmnError.model('E_INVALID_VALUE', 'The timer value is empty', { hint: 'Use ISO 8601: PT5M (duration), R/PT1H (cycle) or 2030-01-01T00:00:00Z (date).' });
    }
    return value;
  }

  private buildConditional(type: string, opts: TriggerOptions): BpmnElement {
    if (opts.when !== undefined) {
      EventDefinitions.assertCondition(opts.when);
    }
    return this.edit.document.tree.build(type, opts.when ? { condition: this.expression(opts.when) } : {});
  }

  private static assertCondition(when: string): void {
    if (!when.trim()) {
      throw BpmnError.model('E_INVALID_VALUE', 'The condition expression is empty', { hint: "Quote expressions with single quotes, e.g. 'when=${approved}'." });
    }
  }

  private rootElement(trigger: RefTrigger, name: string, opts: TriggerOptions): BpmnElement {
    const { type, code } = EventDefinitions.REF_TRIGGERS[trigger];
    return new RootElements(this.edit).ensure(type, name, code ? { [code]: opts[code] } : {}).el;
  }

  private updateReference(def: BpmnElement, trigger: RefTrigger, opts: TriggerOptions): void {
    const name = EventDefinitions.rootName(trigger, opts);
    if (name === undefined) {
      return;
    }
    const { prop } = EventDefinitions.REF_TRIGGERS[trigger];
    if (!name) {
      def.set(prop, undefined);
      return;
    }
    const el = this.rootElement(trigger, name, opts);
    if (def.get<BpmnElement | undefined>(prop) !== el) {
      def.set(prop, el);
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
    const value = EventDefinitions.timerValue(opts.timer);
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
    EventDefinitions.assertCondition(opts.when);
    const expr = def.get<BpmnElement | undefined>('condition');
    const dropped: string[] = [];
    if (expr && expr.get<string | undefined>('body') !== opts.when) {
      const coercer = new PropertyCoercer(this.edit);
      const resourceKey = Object.keys(expr.attrs).find((attrKey) => coercer.isResourceKey(attrKey));
      const language = expr.get<string | undefined>('language');
      if (resourceKey) {
        dropped.push(`${resourceKey} ${String(expr.attrs[resourceKey])}`);
        delete expr.attrs[resourceKey];
      }
      if (language && (resourceKey || (PropertyCoercer.isExpression(opts.when) && language.toLowerCase() !== 'juel'))) {
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

  private updateDefinition(event: BpmnElement, def: BpmnElement, trigger: DefinedTrigger, opts: TriggerOptions): Finding[] {
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
}
