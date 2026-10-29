/**
 * The kind vocabulary: lowerCamel BPMN names (`userTask`), what the AI sees in any .bpmn file.
 * Also accepted: aliases (`user`) and moddle types; events take a trigger (`boundary:timer`).
 */
import { BpmnError } from './BpmnError.js';
import { is, typeLabel, type El } from './utils/moddle.js';
import { usageError } from './utils/errors.js';
import { levenshtein } from './utils/fuzzy.js';

export type Family =
  | 'task'
  | 'subProcess'
  | 'callActivity'
  | 'gateway'
  | 'event'
  | 'participant'
  | 'lane'
  | 'data'
  | 'artifact';

export const FLOW_NODE_FAMILIES: ReadonlySet<Family> = new Set(['task', 'subProcess', 'callActivity', 'gateway', 'event']);

export type Trigger =
  | 'none'
  | 'message'
  | 'timer'
  | 'error'
  | 'signal'
  | 'escalation'
  | 'conditional'
  | 'link'
  | 'compensate'
  | 'terminate'
  | 'cancel';

export interface KindDef {
  kind: string;
  type: string;
  family: Family;
  aliases: string[];
  /** allowed triggers (events only) */
  triggers?: Trigger[];
  /** extra properties set on creation */
  props?: Record<string, unknown>;
  /** gateways only: evaluates conditions and may have a default flow */
  branchesByCondition?: true;
  /** gateways only: a join waits for its incoming paths */
  synchronises?: true;
  /** gateways only: a split is named as the question its branches answer */
  namedAsQuestion?: true;
  description: string;
}

export interface RootReference {
  option: 'message' | 'error' | 'signal' | 'escalation';
  refProperty: string;
  codeProperty?: 'errorCode' | 'escalationCode';
}

export interface TriggerDef {
  definition: string;
  root?: RootReference;
}

export const TRIGGERS: Record<Exclude<Trigger, 'none'>, TriggerDef> = {
  message: { definition: 'bpmn:MessageEventDefinition', root: { option: 'message', refProperty: 'messageRef' } },
  timer: { definition: 'bpmn:TimerEventDefinition' },
  error: { definition: 'bpmn:ErrorEventDefinition', root: { option: 'error', refProperty: 'errorRef', codeProperty: 'errorCode' } },
  signal: { definition: 'bpmn:SignalEventDefinition', root: { option: 'signal', refProperty: 'signalRef' } },
  escalation: { definition: 'bpmn:EscalationEventDefinition', root: { option: 'escalation', refProperty: 'escalationRef', codeProperty: 'escalationCode' } },
  conditional: { definition: 'bpmn:ConditionalEventDefinition' },
  link: { definition: 'bpmn:LinkEventDefinition' },
  compensate: { definition: 'bpmn:CompensateEventDefinition' },
  terminate: { definition: 'bpmn:TerminateEventDefinition' },
  cancel: { definition: 'bpmn:CancelEventDefinition' },
};

const TRIGGER_ALIASES: Record<string, Trigger> = {
  compensation: 'compensate',
  condition: 'conditional',
  msg: 'message',
  time: 'timer',
};

export const KINDS: KindDef[] = [
  { kind: 'task', type: 'bpmn:Task', family: 'task', aliases: [], description: 'Generic task' },
  { kind: 'userTask', type: 'bpmn:UserTask', family: 'task', aliases: ['user'], description: 'Task performed by a human' },
  { kind: 'serviceTask', type: 'bpmn:ServiceTask', family: 'task', aliases: ['service'], description: 'Automated task (worker / connector)' },
  { kind: 'scriptTask', type: 'bpmn:ScriptTask', family: 'task', aliases: ['script'], description: 'Task executing a script' },
  { kind: 'sendTask', type: 'bpmn:SendTask', family: 'task', aliases: ['send'], description: 'Task sending a message' },
  { kind: 'receiveTask', type: 'bpmn:ReceiveTask', family: 'task', aliases: ['receive'], description: 'Task waiting for a message' },
  { kind: 'manualTask', type: 'bpmn:ManualTask', family: 'task', aliases: ['manual'], description: 'Task done outside the engine' },
  { kind: 'businessRuleTask', type: 'bpmn:BusinessRuleTask', family: 'task', aliases: ['rule', 'businessRule', 'decision'], description: 'Task evaluating a decision / rule' },
  { kind: 'subProcess', type: 'bpmn:SubProcess', family: 'subProcess', aliases: ['sub'], description: 'Embedded sub-process (expanded by default, use --collapsed to collapse)' },
  { kind: 'eventSubProcess', type: 'bpmn:SubProcess', family: 'subProcess', aliases: ['eventSub'], props: { triggeredByEvent: true }, description: 'Event sub-process (triggeredByEvent=true); create it as eventSubProcess:<trigger> (message|timer|signal|conditional|error|escalation|compensate) to get its start event in the same command' },
  { kind: 'adHocSubProcess', type: 'bpmn:AdHocSubProcess', family: 'subProcess', aliases: ['adhoc'], description: 'Ad-hoc sub-process' },
  { kind: 'transaction', type: 'bpmn:Transaction', family: 'subProcess', aliases: [], description: 'Transaction sub-process' },
  { kind: 'callActivity', type: 'bpmn:CallActivity', family: 'callActivity', aliases: ['call'], description: 'Calls another process (set calledElement=<processId>)' },
  { kind: 'exclusiveGateway', type: 'bpmn:ExclusiveGateway', family: 'gateway', aliases: ['xor', 'exclusive'], branchesByCondition: true, namedAsQuestion: true, description: 'XOR: exactly one outgoing path (name it as a question, name the branches)' },
  { kind: 'parallelGateway', type: 'bpmn:ParallelGateway', family: 'gateway', aliases: ['and', 'parallel'], synchronises: true, description: 'AND: all outgoing paths' },
  { kind: 'inclusiveGateway', type: 'bpmn:InclusiveGateway', family: 'gateway', aliases: ['or', 'inclusive'], branchesByCondition: true, synchronises: true, namedAsQuestion: true, description: 'OR: one or more outgoing paths' },
  { kind: 'complexGateway', type: 'bpmn:ComplexGateway', family: 'gateway', aliases: ['complex'], branchesByCondition: true, synchronises: true, description: 'Complex: a custom split / join rule (no Camunda 7 / 8 engine runs it)' },
  { kind: 'eventBasedGateway', type: 'bpmn:EventBasedGateway', family: 'gateway', aliases: ['eventBased', 'event-based', 'eventGateway'], description: 'Waits for the first of several catching events' },
  { kind: 'startEvent', type: 'bpmn:StartEvent', family: 'event', aliases: ['start'], triggers: ['none', 'message', 'timer', 'signal', 'conditional', 'error', 'escalation', 'compensate'], description: 'Start event (error/escalation/compensate only inside an eventSubProcess)' },
  { kind: 'endEvent', type: 'bpmn:EndEvent', family: 'event', aliases: ['end'], triggers: ['none', 'message', 'error', 'signal', 'escalation', 'terminate', 'compensate', 'cancel'], description: 'End event' },
  { kind: 'intermediateCatchEvent', type: 'bpmn:IntermediateCatchEvent', family: 'event', aliases: ['catch', 'icatch', 'catchEvent'], triggers: ['message', 'timer', 'signal', 'conditional', 'link'], description: 'Intermediate catching event (waits)' },
  { kind: 'intermediateThrowEvent', type: 'bpmn:IntermediateThrowEvent', family: 'event', aliases: ['throw', 'ithrow', 'throwEvent'], triggers: ['none', 'message', 'signal', 'escalation', 'link', 'compensate'], description: 'Intermediate throwing event' },
  { kind: 'boundaryEvent', type: 'bpmn:BoundaryEvent', family: 'event', aliases: ['boundary'], triggers: ['message', 'timer', 'error', 'signal', 'escalation', 'conditional', 'compensate', 'cancel'], description: 'Boundary event attached to an activity (--on <hostId>)' },
  { kind: 'participant', type: 'bpmn:Participant', family: 'participant', aliases: ['pool'], description: 'Pool; the first one wraps the existing process, further ones get a new process (--black-box for none)' },
  { kind: 'lane', type: 'bpmn:Lane', family: 'lane', aliases: [], description: 'Lane inside a process (--in <processId>)' },
  { kind: 'dataObject', type: 'bpmn:DataObjectReference', family: 'data', aliases: ['data', 'dataObjectReference'], description: 'Data object (reference + backing bpmn:DataObject)' },
  { kind: 'dataStore', type: 'bpmn:DataStoreReference', family: 'data', aliases: ['store', 'dataStoreReference'], description: 'Data store reference' },
  { kind: 'textAnnotation', type: 'bpmn:TextAnnotation', family: 'artifact', aliases: ['note', 'annotation', 'text'], description: 'Text annotation (connect it to an element to draw an association)' },
  { kind: 'group', type: 'bpmn:Group', family: 'artifact', aliases: [], description: 'Group drawn around its members (--members <id,...>; the members reference its category value)' },
];

const REJECTED_TYPES: Record<string, string> = {
  'bpmn:ChoreographyTask': 'choreographies are not supported',
  'bpmn:SubChoreography': 'choreographies are not supported',
  'bpmn:CallChoreography': 'choreographies are not supported',
  'bpmn:ImplicitThrowEvent': 'implicit throw events are not supported',
};

const byToken = new Map<string, KindDef>();
for (const def of KINDS) {
  const tokens = [def.kind, def.type, def.type.split(':')[1] ?? '', ...def.aliases];
  for (const token of tokens) {
    if (token) byToken.set(token.toLowerCase(), def);
  }
}
// eventSubProcess shares its type with subProcess: keep subProcess for 'bpmn:SubProcess'
byToken.set('bpmn:subprocess', KINDS.find((kindDef) => kindDef.kind === 'subProcess')!);
byToken.set('subprocess', KINDS.find((kindDef) => kindDef.kind === 'subProcess')!);

export interface ParsedKind {
  def: KindDef;
  trigger?: Trigger;
}

export function normalizeTrigger(raw: string): Trigger | undefined {
  const token = raw.trim().toLowerCase();
  if (!token) return undefined;
  const alias = TRIGGER_ALIASES[token];
  if (alias) return alias;
  if (token === 'none') return 'none';
  return (Object.keys(TRIGGERS) as Trigger[]).find((trigger) => trigger === token);
}

/**
 * Resolves `kind[:trigger]`. Throws a usage BpmnError with candidates on failure.
 * A namespaced type (`bpmn:UserTask`) is read whole, not as a kind with a trigger.
 */
export function parseKind(token: string): ParsedKind {
  const [rawKind = '', ...rest] = token.trim().split(':');
  let kindToken = rawKind;
  let triggerToken = rest.join(':');
  if (rawKind.toLowerCase() === 'bpmn' && rest.length) {
    kindToken = `bpmn:${rest[0]}`;
    triggerToken = rest.slice(1).join(':');
  }
  const def = byToken.get(kindToken.toLowerCase());
  if (!def) {
    const rejected = Object.entries(REJECTED_TYPES).find(([rejectedType]) => {
      const local = rejectedType.split(':')[1]!.toLowerCase();
      const kind = kindToken.toLowerCase().replace(/^bpmn:/, '');
      return local === kind || local === `${kind}gateway` || local === `${kind}event`;
    });
    if (rejected) {
      throw new BpmnError('E_UNSUPPORTED_KIND', `Kind "${kindToken}" is rejected: ${rejected[1]}`, 'usage', { hint: 'Run `bpmn kinds` for the supported kinds.' });
    }
    const candidates = suggestKinds(kindToken);
    throw new BpmnError('E_UNKNOWN_KIND', `Unknown kind "${kindToken}"${candidates.length ? ` (did you mean: ${candidates.join(', ')}?)` : ''}. Run \`bpmn kinds\` for the full list.`, 'usage', {
      candidates,
      hint: 'Run `bpmn kinds` for the full list.',
    });
  }
  if (!triggerToken) return { def };
  const trigger = normalizeTrigger(triggerToken);
  if (!trigger) {
    throw triggerError(`Unknown event trigger "${triggerToken}". Allowed: ${['none', ...Object.keys(TRIGGERS)].join(', ')}`);
  }
  if (!def.triggers) {
    throw triggerError(`Kind "${def.kind}" is not an event and cannot have a trigger (":${triggerToken}")`);
  }
  if (!def.triggers.includes(trigger)) {
    throw triggerError(`Trigger "${trigger}" is not allowed on ${def.kind}. Allowed: ${def.triggers.join(', ')}`);
  }
  return { def, trigger };
}

function triggerError(message: string): BpmnError {
  return new BpmnError('E_INVALID_TRIGGER', message, 'usage', { hint: 'Use kind:trigger, e.g. startEvent:message or boundaryEvent:timer.' });
}

/** A kind token given as an option (`find --kind`) fails with the same codes as `add`. */
export function assertKindToken(value: string): void {
  try {
    parseKind(value);
  } catch (err) {
    if (!(err instanceof BpmnError)) throw err;
    const { candidates } = err.details;
    throw new BpmnError(err.code, err.message, 'usage', { ...(candidates?.length ? { candidates } : {}), hint: 'Run `bpmn kinds` for the full list of kinds and triggers.' });
  }
}

/** `parseKind`, and `eventSubProcess:<trigger>`, which `add` creates with its start event inside. */
export function parseKindToAdd(token: string): ParsedKind {
  try {
    return parseKind(token);
  } catch (err) {
    if (!(err instanceof BpmnError)) throw err;
    const eventSubProcess = parseEventSubProcessKind(token);
    if (eventSubProcess) return eventSubProcess;
    throw err;
  }
}

function parseEventSubProcessKind(token: string): ParsedKind | undefined {
  const idx = token.indexOf(':');
  if (idx < 0) return undefined;
  let base: ParsedKind;
  try {
    base = parseKind(token.slice(0, idx));
  } catch {
    return undefined;
  }
  if (base.def.kind !== 'eventSubProcess') return undefined;
  const raw = token.slice(idx + 1);
  const trigger = normalizeTrigger(raw);
  const eventSubProcessTriggers: Trigger[] = (kindByName('startEvent')?.triggers ?? []).filter((startTrigger) => startTrigger !== 'none');
  if (!trigger || !eventSubProcessTriggers.includes(trigger)) {
    throw new BpmnError('E_INVALID_TRIGGER', `Trigger "${raw}" is not allowed on eventSubProcess. Allowed: ${eventSubProcessTriggers.join(', ')}`, 'usage', {
      candidates: eventSubProcessTriggers,
      hint: 'eventSubProcess:<trigger> creates the event sub-process with a startEvent:<trigger> inside, e.g. eventSubProcess:error --error PaymentFailed.',
    });
  }
  return { def: base.def, trigger };
}

export function suggestKinds(token: string, max = 4): string[] {
  const lowerToken = token.toLowerCase().replace(/^bpmn:/, '');
  const scored = KINDS.map((def) => {
    const names = [def.kind, ...def.aliases].map((name) => name.toLowerCase());
    let best = Infinity;
    for (const name of names) {
      if (name.includes(lowerToken) || lowerToken.includes(name)) {
        best = Math.min(best, 1);
      }
      best = Math.min(best, levenshtein(name, lowerToken));
    }
    return { kind: def.kind, score: best };
  });
  return scored
    .filter((scored) => scored.score <= Math.max(2, Math.floor(lowerToken.length / 3)))
    .sort((left, right) => left.score - right.score)
    .slice(0, max)
    .map((scored) => scored.kind);
}

export function kindByName(kind: string): KindDef | undefined {
  return KINDS.find((kindDef) => kindDef.kind === kind);
}

export function kindOf(el: El): KindDef | undefined {
  if (is(el, 'bpmn:SubProcess') && !is(el, 'bpmn:AdHocSubProcess') && !is(el, 'bpmn:Transaction')) {
    return el.get<boolean | undefined>('triggeredByEvent') ? kindByName('eventSubProcess') : kindByName('subProcess');
  }
  return KINDS.find((kindDef) => kindDef.type === el.$type);
}

export function branchesByCondition(el: El): boolean {
  return !!kindOf(el)?.branchesByCondition;
}

export function ignoresConditions(el: El): boolean {
  return kindOf(el)?.family === 'gateway' && !branchesByCondition(el);
}

export function synchronises(el: El): boolean {
  return !!kindOf(el)?.synchronises;
}

export function namedAsQuestion(el: El): boolean {
  return !!kindOf(el)?.namedAsQuestion;
}

/** `exclusiveGateway (xor), parallelGateway (and), ...` for hints. */
export function gatewayKindList(): string {
  const gateways = KINDS.filter((kindDef) => kindDef.family === 'gateway').map((kindDef) => (kindDef.aliases[0] ? `${kindDef.kind} (${kindDef.aliases[0]})` : kindDef.kind));
  return `${gateways.slice(0, -1).join(', ')} or ${gateways.at(-1)}`;
}

/** From the first event definition. */
export function triggerOf(el: El): Trigger | undefined {
  if (!is(el, 'bpmn:Event')) return undefined;
  const defs = el.get<El[] | undefined>('eventDefinitions') ?? [];
  const first = defs[0];
  if (!first) return 'none';
  return triggerOfDefinition(first);
}

export function triggerOfDefinition(definition: El): Exclude<Trigger, 'none'> | undefined {
  return (Object.keys(TRIGGERS) as Array<Exclude<Trigger, 'none'>>).find((trigger) => is(definition, TRIGGERS[trigger].definition));
}

/** A link throw ends its path: it continues at the link catch of the same name. */
export function isLinkThrow(el: El): boolean {
  return is(el, 'bpmn:IntermediateThrowEvent') && triggerOf(el) === 'link';
}

export function isLinkCatch(el: El): boolean {
  return is(el, 'bpmn:IntermediateCatchEvent') && triggerOf(el) === 'link';
}

export function isEventSubProcess(el: El | undefined): boolean {
  return !!el && is(el, 'bpmn:SubProcess') && el.get<boolean | undefined>('triggeredByEvent') === true;
}

/** The intermediate catch event triggers an event-based gateway may wait for. */
export const EVENT_GATEWAY_TRIGGERS: readonly Trigger[] = ['message', 'timer', 'signal', 'conditional'];

export function kindLabel(el: El): string {
  const def = kindOf(el);
  if (!def) return el.$type;
  const trigger = triggerOf(el);
  if (trigger && trigger !== 'none') return `${def.kind}:${trigger}`;
  return def.kind;
}

export function isRejectedType(type: string): string | undefined {
  return REJECTED_TYPES[type];
}

/** The canonical kind for kinds the AI can create, else the lowerCamel local type. */
export function kindOrTypeLabel(el: El): string {
  if (kindOf(el)) return kindLabel(el);
  if (is(el, 'bpmn:DataAssociation')) return 'dataAssociation';
  return typeLabel(el);
}

/** Non-kind labels `find --kind` also accepts. */
const EXTRA_KINDS = ['sequenceFlow', 'messageFlow', 'association', 'dataAssociation', 'process', 'collaboration', 'message', 'error', 'signal', 'escalation'];

export function kindFilter(kind: string): (el: El) => boolean {
  try {
    const { def, trigger } = parseKind(kind);
    return (el) => kindOf(el)?.kind === def.kind && (!trigger || triggerOf(el) === trigger);
  } catch (err) {
    if (!(err instanceof BpmnError)) throw err;
    const token = kind.trim().toLowerCase();
    const extra = EXTRA_KINDS.find((kind) => kind.toLowerCase() === token);
    if (extra) return (el) => kindOrTypeLabel(el) === extra;
    throw usageError(err.message, { candidates: [...(err.details.candidates ?? []), ...EXTRA_KINDS.filter((kind) => kind.toLowerCase().includes(token))] });
  }
}
