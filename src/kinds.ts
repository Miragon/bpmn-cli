/**
 * The vocabulary the AI uses to name element kinds.
 *
 * Canonical kind = lowerCamel BPMN element name (`userTask`), i.e. what the AI
 * already sees in any .bpmn file. Also accepted: short aliases (`user`), the
 * moddle type with or without prefix (`bpmn:UserTask`, `UserTask`). Events
 * take an optional trigger suffix: `startEvent:message`, `boundary:timer`.
 */
import { CliError } from './errors.js';
import { is, type El } from './model.js';

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
  /** id prefix (bpmn-js convention) */
  prefix: string;
  /** allowed triggers (events only) */
  triggers?: Trigger[];
  /** extra properties set on creation */
  props?: Record<string, unknown>;
  description: string;
}

export const TRIGGER_TYPES: Record<Exclude<Trigger, 'none'>, string> = {
  message: 'bpmn:MessageEventDefinition',
  timer: 'bpmn:TimerEventDefinition',
  error: 'bpmn:ErrorEventDefinition',
  signal: 'bpmn:SignalEventDefinition',
  escalation: 'bpmn:EscalationEventDefinition',
  conditional: 'bpmn:ConditionalEventDefinition',
  link: 'bpmn:LinkEventDefinition',
  compensate: 'bpmn:CompensateEventDefinition',
  terminate: 'bpmn:TerminateEventDefinition',
  cancel: 'bpmn:CancelEventDefinition',
};

const TRIGGER_ALIASES: Record<string, Trigger> = {
  compensation: 'compensate',
  condition: 'conditional',
  msg: 'message',
  time: 'timer',
};

export const KINDS: KindDef[] = [
  // tasks
  { kind: 'task', type: 'bpmn:Task', family: 'task', aliases: [], prefix: 'Activity', description: 'Generic task' },
  { kind: 'userTask', type: 'bpmn:UserTask', family: 'task', aliases: ['user'], prefix: 'Activity', description: 'Task performed by a human' },
  { kind: 'serviceTask', type: 'bpmn:ServiceTask', family: 'task', aliases: ['service'], prefix: 'Activity', description: 'Automated task (worker / connector)' },
  { kind: 'scriptTask', type: 'bpmn:ScriptTask', family: 'task', aliases: ['script'], prefix: 'Activity', description: 'Task executing a script' },
  { kind: 'sendTask', type: 'bpmn:SendTask', family: 'task', aliases: ['send'], prefix: 'Activity', description: 'Task sending a message' },
  { kind: 'receiveTask', type: 'bpmn:ReceiveTask', family: 'task', aliases: ['receive'], prefix: 'Activity', description: 'Task waiting for a message' },
  { kind: 'manualTask', type: 'bpmn:ManualTask', family: 'task', aliases: ['manual'], prefix: 'Activity', description: 'Task done outside the engine' },
  { kind: 'businessRuleTask', type: 'bpmn:BusinessRuleTask', family: 'task', aliases: ['rule', 'businessRule', 'decision'], prefix: 'Activity', description: 'Task evaluating a decision / rule' },
  // sub-processes & call activity
  { kind: 'subProcess', type: 'bpmn:SubProcess', family: 'subProcess', aliases: ['sub'], prefix: 'Activity', description: 'Embedded sub-process (expanded by default, use --collapsed to collapse)' },
  { kind: 'eventSubProcess', type: 'bpmn:SubProcess', family: 'subProcess', aliases: ['eventSub'], prefix: 'Activity', props: { triggeredByEvent: true }, description: 'Event sub-process (triggeredByEvent=true); create it as eventSubProcess:<trigger> (message|timer|signal|conditional|error|escalation|compensate) to get its start event in the same command' },
  { kind: 'adHocSubProcess', type: 'bpmn:AdHocSubProcess', family: 'subProcess', aliases: ['adhoc'], prefix: 'Activity', description: 'Ad-hoc sub-process' },
  { kind: 'transaction', type: 'bpmn:Transaction', family: 'subProcess', aliases: [], prefix: 'Activity', description: 'Transaction sub-process' },
  { kind: 'callActivity', type: 'bpmn:CallActivity', family: 'callActivity', aliases: ['call'], prefix: 'Activity', description: 'Calls another process (set calledElement=<processId>)' },
  // gateways
  { kind: 'exclusiveGateway', type: 'bpmn:ExclusiveGateway', family: 'gateway', aliases: ['xor', 'exclusive'], prefix: 'Gateway', description: 'XOR: exactly one outgoing path (name it as a question, name the branches)' },
  { kind: 'parallelGateway', type: 'bpmn:ParallelGateway', family: 'gateway', aliases: ['and', 'parallel'], prefix: 'Gateway', description: 'AND: all outgoing paths' },
  { kind: 'inclusiveGateway', type: 'bpmn:InclusiveGateway', family: 'gateway', aliases: ['or', 'inclusive'], prefix: 'Gateway', description: 'OR: one or more outgoing paths' },
  { kind: 'eventBasedGateway', type: 'bpmn:EventBasedGateway', family: 'gateway', aliases: ['eventBased', 'event-based', 'eventGateway'], prefix: 'Gateway', description: 'Waits for the first of several catching events' },
  // events
  { kind: 'startEvent', type: 'bpmn:StartEvent', family: 'event', aliases: ['start'], prefix: 'Event', triggers: ['none', 'message', 'timer', 'signal', 'conditional', 'error', 'escalation', 'compensate'], description: 'Start event (error/escalation/compensate only inside an eventSubProcess)' },
  { kind: 'endEvent', type: 'bpmn:EndEvent', family: 'event', aliases: ['end'], prefix: 'Event', triggers: ['none', 'message', 'error', 'signal', 'escalation', 'terminate', 'compensate', 'cancel'], description: 'End event' },
  { kind: 'intermediateCatchEvent', type: 'bpmn:IntermediateCatchEvent', family: 'event', aliases: ['catch', 'icatch', 'catchEvent'], prefix: 'Event', triggers: ['message', 'timer', 'signal', 'conditional', 'link'], description: 'Intermediate catching event (waits)' },
  { kind: 'intermediateThrowEvent', type: 'bpmn:IntermediateThrowEvent', family: 'event', aliases: ['throw', 'ithrow', 'throwEvent'], prefix: 'Event', triggers: ['none', 'message', 'signal', 'escalation', 'link', 'compensate'], description: 'Intermediate throwing event' },
  { kind: 'boundaryEvent', type: 'bpmn:BoundaryEvent', family: 'event', aliases: ['boundary'], prefix: 'Event', triggers: ['message', 'timer', 'error', 'signal', 'escalation', 'conditional', 'compensate', 'cancel'], description: 'Boundary event attached to an activity (--on <hostId>)' },
  // containers
  { kind: 'participant', type: 'bpmn:Participant', family: 'participant', aliases: ['pool'], prefix: 'Participant', description: 'Pool; the first one wraps the existing process, further ones get a new process (--black-box for none)' },
  { kind: 'lane', type: 'bpmn:Lane', family: 'lane', aliases: [], prefix: 'Lane', description: 'Lane inside a process (--in <processId>)' },
  // data & artifacts
  { kind: 'dataObject', type: 'bpmn:DataObjectReference', family: 'data', aliases: ['data', 'dataObjectReference'], prefix: 'DataObjectReference', description: 'Data object (reference + backing bpmn:DataObject)' },
  { kind: 'dataStore', type: 'bpmn:DataStoreReference', family: 'data', aliases: ['store', 'dataStoreReference'], prefix: 'DataStoreReference', description: 'Data store reference' },
  { kind: 'textAnnotation', type: 'bpmn:TextAnnotation', family: 'artifact', aliases: ['note', 'annotation', 'text'], prefix: 'TextAnnotation', description: 'Text annotation (connect it to an element to draw an association)' },
];

const REJECTED_TYPES: Record<string, string> = {
  'bpmn:ComplexGateway': 'the layout engine cannot draw complex gateways; use exclusiveGateway or inclusiveGateway',
  'bpmn:ChoreographyTask': 'choreographies are not supported',
  'bpmn:SubChoreography': 'choreographies are not supported',
  'bpmn:CallChoreography': 'choreographies are not supported',
  'bpmn:ImplicitThrowEvent': 'implicit throw events are not supported',
  'bpmn:Group': 'groups are not supported in this version',
};

const byToken = new Map<string, KindDef>();
for (const def of KINDS) {
  const tokens = [def.kind, def.type, def.type.split(':')[1] ?? '', ...def.aliases];
  for (const t of tokens) if (t) byToken.set(t.toLowerCase(), def);
}
// eventSubProcess shares its type with subProcess: keep subProcess for 'bpmn:SubProcess'
byToken.set('bpmn:subprocess', KINDS.find((k) => k.kind === 'subProcess')!);
byToken.set('subprocess', KINDS.find((k) => k.kind === 'subProcess')!);

export interface ParsedKind {
  def: KindDef;
  trigger?: Trigger;
}

export class KindError extends Error {
  constructor(
    message: string,
    public readonly candidates: string[] = [],
  ) {
    super(message);
    this.name = 'KindError';
  }
}

export function normalizeTrigger(raw: string): Trigger | undefined {
  const t = raw.trim().toLowerCase();
  if (!t) return undefined;
  const alias = TRIGGER_ALIASES[t];
  if (alias) return alias;
  if (t === 'none') return 'none';
  return (Object.keys(TRIGGER_TYPES) as Trigger[]).find((k) => k === t);
}

/** Resolves `kind[:trigger]`. Throws KindError with candidates on failure. */
export function parseKind(token: string): ParsedKind {
  const [rawKind = '', ...rest] = token.trim().split(':');
  // `bpmn:UserTask` contains a colon too: re-join when the first part is a namespace prefix
  let kindToken = rawKind;
  let triggerToken = rest.join(':');
  if (rawKind.toLowerCase() === 'bpmn' && rest.length) {
    kindToken = `bpmn:${rest[0]}`;
    triggerToken = rest.slice(1).join(':');
  }
  const def = byToken.get(kindToken.toLowerCase());
  if (!def) {
    const rejected = Object.entries(REJECTED_TYPES).find(([t]) => {
      const local = t.split(':')[1]!.toLowerCase();
      const k = kindToken.toLowerCase().replace(/^bpmn:/, '');
      return local === k || local === `${k}gateway` || local === `${k}event`;
    });
    if (rejected) throw new KindError(`Kind "${kindToken}" is rejected: ${rejected[1]}`);
    const candidates = suggestKinds(kindToken);
    throw new KindError(
      `Unknown kind "${kindToken}"${candidates.length ? ` (did you mean: ${candidates.join(', ')}?)` : ''}. Run \`bpmn kinds\` for the full list.`,
      candidates,
    );
  }
  if (!triggerToken) return { def };
  const trigger = normalizeTrigger(triggerToken);
  if (!trigger) {
    throw new KindError(`Unknown event trigger "${triggerToken}". Allowed: ${['none', ...Object.keys(TRIGGER_TYPES)].join(', ')}`);
  }
  if (!def.triggers) {
    throw new KindError(`Kind "${def.kind}" is not an event and cannot have a trigger (":${triggerToken}")`);
  }
  if (!def.triggers.includes(trigger)) {
    throw new KindError(`Trigger "${trigger}" is not allowed on ${def.kind}. Allowed: ${def.triggers.join(', ')}`);
  }
  return { def, trigger };
}

/**
 * A kind token given as an option (`find --kind`): its KindError as the
 * documented usage error (E_UNSUPPORTED_KIND, E_UNKNOWN_KIND with
 * candidates, E_INVALID_TRIGGER), like `add` reports it.
 */
export function assertKindToken(value: string): void {
  try {
    parseKind(value);
  } catch (err) {
    if (!(err instanceof KindError)) throw err;
    const code = /is rejected/.test(err.message) ? 'E_UNSUPPORTED_KIND' : /^Unknown kind/.test(err.message) ? 'E_UNKNOWN_KIND' : 'E_INVALID_TRIGGER';
    throw new CliError(code, err.message, 'usage', { ...(err.candidates?.length ? { candidates: err.candidates } : {}), hint: 'Run `bpmn kinds` for the full list of kinds and triggers.' });
  }
}

export function suggestKinds(token: string, max = 4): string[] {
  const t = token.toLowerCase().replace(/^bpmn:/, '');
  const scored = KINDS.map((def) => {
    const names = [def.kind, ...def.aliases].map((n) => n.toLowerCase());
    let best = Infinity;
    for (const n of names) {
      if (n.includes(t) || t.includes(n)) best = Math.min(best, 1);
      best = Math.min(best, levenshtein(n, t));
    }
    return { kind: def.kind, score: best };
  });
  return scored
    .filter((s) => s.score <= Math.max(2, Math.floor(t.length / 3)))
    .sort((a, b) => a.score - b.score)
    .slice(0, max)
    .map((s) => s.kind);
}

function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length]![b.length]!;
}

export function kindByName(kind: string): KindDef | undefined {
  return KINDS.find((k) => k.kind === kind);
}

/** Canonical kind of an existing element (or undefined for non-kind elements). */
export function kindOf(el: El): KindDef | undefined {
  if (is(el, 'bpmn:SubProcess') && !is(el, 'bpmn:AdHocSubProcess') && !is(el, 'bpmn:Transaction')) {
    return el.get<boolean | undefined>('triggeredByEvent') ? kindByName('eventSubProcess') : kindByName('subProcess');
  }
  return KINDS.find((k) => k.type === el.$type);
}

/** Trigger of an event element, derived from its (first) event definition. */
export function triggerOf(el: El): Trigger | undefined {
  if (!is(el, 'bpmn:Event')) return undefined;
  const defs = el.get<El[] | undefined>('eventDefinitions') ?? [];
  const first = defs[0];
  if (!first) return 'none';
  const entry = (Object.entries(TRIGGER_TYPES) as Array<[Trigger, string]>).find(([, type]) => is(first, type));
  return entry?.[0];
}

/** `userTask`, `startEvent:message`, `boundaryEvent:timer` ... for display. */
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

export function idPrefixFor(el: El): string {
  const def = kindOf(el);
  if (def) return def.prefix;
  if (is(el, 'bpmn:SequenceFlow') || is(el, 'bpmn:MessageFlow')) return 'Flow';
  if (is(el, 'bpmn:Activity')) return 'Activity';
  if (is(el, 'bpmn:Event')) return 'Event';
  if (is(el, 'bpmn:Gateway')) return 'Gateway';
  return el.$type.split(':')[1] ?? 'Element';
}
