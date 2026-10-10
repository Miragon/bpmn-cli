/**
 * `add`: create one element and wire it in.
 *
 *  - parseKind(op.kind); rejected/unknown kinds -> E_UNSUPPORTED_KIND / E_UNKNOWN_KIND
 *  - id: op.id (claimId) or a speaking id in the file's style
 *    (doc.allocateId with kindRequest: kind, trigger, name, and the placement
 *    as the context of an unnamed element: Gateway_AfterCheckInvoice,
 *    Event_TimerOnReview; src/idstyle.ts); a taken id gets a `_2` suffix
 *    (W_ID_SUFFIXED, reported by ops/index.ts).
 *  - op.ifAbsent with op.id and the element exists -> empty ChangeSet with a note;
 *    ifAbsent without an id is E_USAGE (same rule as `apply`).
 *  - flow options: default + condition -> E_USAGE, an empty condition ->
 *    E_INVALID_VALUE (before anything is mutated); options the placement
 *    cannot apply (no flow created by --in/--on, or --flow-id when the flow
 *    into the node already existed) -> W_OPTION_IGNORED.
 *  - eventSubProcess: a trigger (`eventSubProcess:<trigger>` or inferred from
 *    --error/--message/--timer/...) also creates the triggered start event
 *    inside it (an unnamed event: Event_<Trigger>StartIn<SubProcess> by default), so the event sub-process is valid in one op.
 *  - send / receive tasks: --message <name> references a root bpmn:Message
 *    (found by id or name, created when missing), like a message event.
 *  - participants: a new process gets the platform defaults (Doc.initProcess:
 *    camunda:historyTimeToLive in a Camunda 7 file); a user task of a Camunda 8
 *    file gets zeebe:userTask (ops/platform.ts).
 *  - flow nodes: create with name (+ def.props), placeNode() from ./flows.js,
 *    applyTrigger() for events (default trigger 'none'; boundary events and
 *    event sub-process start events require a trigger -> E_TRIGGER_REQUIRED;
 *    a missing trigger is inferred from --timer/--message/... when given),
 *    documentation (op.doc), sub-process expansion (op.collapsed ->
 *    requestCollapse), lane: op.lane -> assignLane, else inherit the lane of
 *    the after/before anchor (or of the host for boundary events; --flow:
 *    of the flow's source). A splice into a flow whose ends are in different
 *    lanes takes the lane of the row the incremental layout puts the node
 *    on (diagram/place.ts: the target's row after a branching source, so
 *    then the target's lane; else the anchor's) and warns W_LANE_INHERITED
 *    naming the other lane (decided before the placement, which may rename
 *    the flow).
 *  - participant / lane -> containers.ts; dataObject / dataStore /
 *    textAnnotation -> artifacts.ts (scope from --in or default; `--after`
 *    etc. are invalid for them: E_INVALID_PLACEMENT; `--to` connects them).
 *  - op.set -> setProperties() from ./set.js on the new element.
 *  - batch aliases (ops/aliases.ts): op.as binds the new element (with
 *    --if-absent and an existing one: that one), op.flowAs the flow the flow
 *    options describe (into the node; a prepend before a join / unconnected
 *    node: out of it); flowAs without such a flow is E_USAGE.
 *  - a new flow out of an event-based gateway (--after, --flow, --before,
 *    or the node is the gateway) to a target BPMN 2.0 does not allow there:
 *    W_EVENT_GATEWAY_TARGET once the trigger is set (plain files; Camunda 7
 *    files get the profile's W_C7_DEPLOY_EVENT_GATEWAY, flows.ts).
 *  - ChangeSet: the node's create entry comes first, flows follow (placeNode),
 *    root Message/Error/Signal/Escalation elements created by the trigger are
 *    reported too.
 *
 * Because 'expanded' lives in DI, explicit collapse requests are recorded per
 * Doc (collapseRequests) so the pipeline can hand them to the layouter.
 */
import type { Doc } from '../document.js';
import { CliError, modelError, usageError } from '../errors.js';
import { contextOf, kindRequest, type ContextWord, type IdRequest } from '../idstyle.js';
import { KindError, kindByName, kindLabel, normalizeTrigger, parseKind, type KindDef, type ParsedKind, type Trigger } from '../kinds.js';
import { addTo, is, localType, many, type El } from '../model.js';
import { ChangeSet } from '../result.js';
import { createAssociation, createDataAssociation, createDataObject, createDataStore, createTextAnnotation } from './artifacts.js';
import { assignLane, createLane, createParticipant, laneOf } from './containers.js';
import { applyTrigger, bindRefAs } from './events.js';
import { inheritedLane, laneInheritedWarning, type InheritedLane } from './lanes.js';
import { assertCondition, placeNode, placementMode, placementScope, warnEventGatewayFlow } from './flows.js';
import { zeebeUserTaskDefault } from './platform.js';
import { setProperties, setTaskMessage } from './set.js';
import type { AddOp, TriggerOptions } from './types.js';

/* ------------------------------------------------------------------ */
/* collapse registry                                                    */
/* ------------------------------------------------------------------ */

/** Sub-process ids the AI asked to collapse, per document (read by the pipeline). */
export const collapseRequests = new WeakMap<Doc, Set<string>>();

/** Records that sub-process `id` must be laid out collapsed. */
export function requestCollapse(doc: Doc, id: string): void {
  let set = collapseRequests.get(doc);
  if (!set) {
    set = new Set<string>();
    collapseRequests.set(doc, set);
  }
  set.add(id);
}

/** Sub-process ids recorded for collapsing on `doc`. */
export function collapsedIds(doc: Doc): string[] {
  return [...(collapseRequests.get(doc) ?? [])];
}

/* ------------------------------------------------------------------ */
/* helpers                                                              */
/* ------------------------------------------------------------------ */

function idOf(el: El): string {
  return el.get<string>('id');
}

/** Start triggers an event sub-process can be created with (`eventSubProcess:<trigger>`). */
const EVENT_SUBPROCESS_TRIGGERS: Trigger[] = (kindByName('startEvent')?.triggers ?? []).filter((t) => t !== 'none');

/** `eventSubProcess:<trigger>`: the trigger of the start event created inside it. */
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
  if (!trigger || !EVENT_SUBPROCESS_TRIGGERS.includes(trigger)) {
    throw new CliError('E_INVALID_TRIGGER', `Trigger "${raw}" is not allowed on eventSubProcess. Allowed: ${EVENT_SUBPROCESS_TRIGGERS.join(', ')}`, 'usage', {
      candidates: EVENT_SUBPROCESS_TRIGGERS,
      hint: 'eventSubProcess:<trigger> creates the event sub-process with a startEvent:<trigger> inside, e.g. eventSubProcess:error --error PaymentFailed.',
    });
  }
  return { def: base.def, trigger };
}

/** A bad kind token is a usage error (exit 1; test/cli.test.ts pins this for `add`). */
function resolveKind(token: string): ParsedKind {
  try {
    return parseKind(token);
  } catch (err) {
    if (!(err instanceof KindError)) throw err;
    const sub = parseEventSubProcessKind(token);
    if (sub) return sub;
    const msg = err.message;
    if (/is rejected/.test(msg)) throw new CliError('E_UNSUPPORTED_KIND', msg, 'usage', { hint: 'Run `bpmn kinds` for the supported kinds.' });
    if (/^Unknown kind/.test(msg)) throw new CliError('E_UNKNOWN_KIND', msg, 'usage', { candidates: err.candidates, hint: 'Run `bpmn kinds` for the full list.' });
    throw new CliError('E_INVALID_TRIGGER', msg, 'usage', { hint: 'Use kind:trigger, e.g. startEvent:message or boundaryEvent:timer.' });
  }
}

/** Allocates the element id: an explicit one is validated and claimed, else a speaking one in the file's style. */
export function allocateElementId(doc: Doc, req: IdRequest, op: { id?: string }): string {
  if (op.id) {
    doc.claimId(op.id);
    return op.id;
  }
  return doc.allocateId(req).id;
}

/**
 * What tells an unnamed element apart: its placement (`After <anchor>`,
 * `Before <anchor>`, `After <source of the flow>`, `On <host>`; `In <scope>`
 * for a sub-process, or a pool / process of a file with several), in the
 * words of contextOf (the nearest named anchor, once).
 */
function placementContext(doc: Doc, op: AddOp): string | undefined {
  const at = (word: ContextWord, id: string | undefined): string => {
    const el = id ? doc.get(id) : undefined;
    return el ? contextOf(word, el) : word;
  };
  switch (placementMode(op)) {
    case 'after':
    case 'between':
      return at('After', op.after);
    case 'before':
      return at('Before', op.before);
    case 'flow': {
      const source = doc.get(op.flow!)?.get<El | undefined>('sourceRef');
      return source ? contextOf('After', source) : undefined;
    }
    case 'on':
      return at('On', op.on);
    default: {
      const scope = op.in ? doc.get(op.in) : undefined;
      if (!scope) return undefined;
      return is(scope, 'bpmn:SubProcess') || doc.processes().length > 1 ? contextOf('In', scope) : undefined;
    }
  }
}

/** The id request of a new element of `def` (the --if-absent hint recomputes it); `context` replaces the placement's. */
function elementRequest(doc: Doc, def: KindDef, trigger: Trigger | undefined, op: AddOp, context?: string): IdRequest {
  const where = context ?? placementContext(doc, op);
  return kindRequest(def, { ...(def.family === 'event' && trigger && trigger !== 'none' ? { trigger } : {}), ...(op.name ? { name: op.name } : {}), ...(where ? { context: where } : {}) });
}

const FLOW_NODE_FAMILIES: ReadonlySet<KindDef['family']> = new Set(['task', 'subProcess', 'callActivity', 'gateway', 'event']);

const PLACEMENT_KEYS = ['after', 'before', 'flow', 'on', 'in'] as const;

function rejectPlacement(op: AddOp, allowed: ReadonlyArray<(typeof PLACEMENT_KEYS)[number] | 'to'>, kind: string): void {
  for (const key of [...PLACEMENT_KEYS, 'to'] as const) {
    if (op[key] !== undefined && !allowed.includes(key)) {
      throw modelError('E_INVALID_PLACEMENT', `--${key} does not apply to ${kind}`, {
        hint: allowed.length ? `${kind} accepts ${allowed.map((k) => `--${k}`).join(', ')} only.` : `${kind} takes no placement options.`,
      });
    }
  }
}

function addDocumentation(doc: Doc, el: El, text: string | undefined): void {
  if (!text) return;
  addTo(el, 'documentation', doc.moddle.create('bpmn:Documentation', { text }));
}

/** Trigger implied by the trigger options (e.g. --timer without :timer). */
function inferTrigger(opts: TriggerOptions): Trigger | undefined {
  if (opts.timer !== undefined) return 'timer';
  if (opts.message !== undefined) return 'message';
  if (opts.error !== undefined || opts.errorCode !== undefined) return 'error';
  if (opts.signal !== undefined) return 'signal';
  if (opts.escalation !== undefined || opts.escalationCode !== undefined) return 'escalation';
  if (opts.when !== undefined) return 'conditional';
  if (opts.link !== undefined) return 'link';
  return undefined;
}

function hasTriggerOptions(opts: TriggerOptions): boolean {
  return inferTrigger(opts) !== undefined || opts.nonInterrupting !== undefined;
}

/** Send and receive tasks reference a message like message events (`--message <name>`). */
function takesMessage(def: KindDef): boolean {
  return def.kind === 'sendTask' || def.kind === 'receiveTask';
}

const TRIGGER_KEYS = ['timer', 'timerKind', 'message', 'error', 'errorCode', 'signal', 'escalation', 'escalationCode', 'when', 'link', 'nonInterrupting'] as const;

/** Just the trigger options of an op (handed to the start event of an event sub-process). */
function triggerOptionsOf(opts: TriggerOptions): TriggerOptions {
  const out: Record<string, unknown> = {};
  for (const key of TRIGGER_KEYS) if (opts[key] !== undefined) out[key] = opts[key];
  return out as TriggerOptions;
}

const FLOW_OPTION_FLAGS = { flowName: '--flow-name', flowId: '--flow-id', condition: '--condition', language: '--language', default: '--default' } as const;

function presentFlowOptions(op: AddOp): string[] {
  return (Object.keys(FLOW_OPTION_FLAGS) as Array<keyof typeof FLOW_OPTION_FLAGS>).filter((k) => op[k] !== undefined && op[k] !== false).map((k) => FLOW_OPTION_FLAGS[k]);
}

/** Rejects contradictory or empty flow options before anything is mutated (same rules as `apply`). */
function checkFlowOptions(op: AddOp): void {
  if (op.default && op.condition !== undefined) {
    throw usageError('--default and --condition are mutually exclusive: a default flow has no condition', {
      hint: 'Keep the condition on the other branches and mark this one as default.',
    });
  }
  assertCondition(op.condition);
}

/** W_OPTION_IGNORED for flow options the placement could not apply. */
function warnIgnoredFlowOptions(doc: Doc, op: AddOp, node: El, entryFlow: El | undefined, cs: ChangeSet): void {
  const id = idOf(node);
  const mode = placementMode(op);
  if (mode === 'in' || mode === 'none' || mode === 'on') {
    const given = presentFlowOptions(op);
    if (given.length) {
      const why = mode === 'on' ? '--on attaches the event, it' : mode === 'in' ? '--in' : 'a placement without --after/--before/--flow';
      cs.warn({
        code: 'W_OPTION_IGNORED',
        message: `${given.join(', ')} ignored for ${id}: ${why} creates no sequence flow into the node`,
        element: id,
        hint: 'Place the node with --after / --before / --flow, or connect it afterwards with `bpmn connect`.',
      });
    }
    return;
  }
  if (op.flowId && !cs.created.some((c) => c.kind === 'sequenceFlow' && c.id === op.flowId)) {
    const entry = entryFlow ?? doc.incoming(node)[0];
    cs.warn({
      code: 'W_OPTION_IGNORED',
      message: `--flow-id ${op.flowId} ignored: the flow into ${id} is the existing ${entry ? idOf(entry) : 'flow'}, which keeps its id`,
      element: id,
      ...(entry ? { related: [idOf(entry)] } : {}),
      hint: `--flow-id only names a flow that add creates (after a gateway / unconnected node, before a join / unconnected node)${entry ? `; rename the existing one with \`bpmn set ${idOf(entry)} id=${op.flowId}\`` : ''}.`,
    });
  }
}

function rootLabel(el: El): string {
  const local = localType(el);
  return local.charAt(0).toLowerCase() + local.slice(1);
}

/** Reports root elements (messages, errors, ...) that appeared during `fn`. */
function reportNewRoots(doc: Doc, cs: ChangeSet, fn: () => void): void {
  const before = new Set(many(doc.definitions, 'rootElements'));
  fn();
  for (const root of many(doc.definitions, 'rootElements')) {
    if (before.has(root)) continue;
    const name = root.get<string | undefined>('name');
    cs.create({ id: idOf(root), kind: rootLabel(root), ...(name ? { name } : {}), detail: 'root element' });
  }
}

function isEventSubProcess(el: El | undefined): boolean {
  return !!el && is(el, 'bpmn:SubProcess') && !!el.get<boolean | undefined>('triggeredByEvent');
}

function placementDetail(doc: Doc, op: AddOp): string {
  switch (placementMode(op)) {
    case 'between':
      return `between ${op.after} and ${op.before}`;
    case 'after':
      return `after ${op.after}`;
    case 'before':
      return `before ${op.before}`;
    case 'flow':
      return `in flow ${op.flow}`;
    case 'on':
      return `on ${op.on}`;
    default:
      return `in ${idOf(placementScope(doc, op))}`;
  }
}

/* ------------------------------------------------------------------ */
/* flow nodes                                                           */
/* ------------------------------------------------------------------ */

/** Resolves --lane before anything is mutated (the target scope must be a process). */
function resolveLane(doc: Doc, op: AddOp): El | undefined {
  if (!op.lane) return undefined;
  const lane = doc.require(op.lane, 'bpmn:Lane', 'lane');
  const scope = placementScope(doc, op);
  if (!is(scope, 'bpmn:Process')) {
    throw modelError('E_INVALID_LANE_MEMBERSHIP', `Nodes inside sub-process ${idOf(scope)} cannot be lane members`, {
      element: op.lane,
      hint: 'Only nodes directly in the process can be assigned to lanes; drop --lane.',
    });
  }
  return lane;
}

function addFlowNode(doc: Doc, op: AddOp, def: KindDef, trigger: Trigger | undefined, cs: ChangeSet, context: string | undefined): El {
  checkFlowOptions(op);
  const explicitLane = resolveLane(doc, op);
  const id = allocateElementId(doc, elementRequest(doc, def, trigger ?? inferTrigger(op), op, context), op);
  const el = doc.create(def.type, { id, ...(op.name ? { name: op.name } : {}), ...(def.props ?? {}) });
  const isEvent = def.family === 'event';
  const isEventSub = def.kind === 'eventSubProcess';
  // an event sub-process created with a trigger gets its triggered start event in the same op
  const startTrigger = isEventSub ? (trigger ?? inferTrigger(op)) : undefined;
  const messageTask = takesMessage(def) && op.message !== undefined;
  if (!isEvent && !startTrigger && hasTriggerOptions(messageTask ? { ...op, message: undefined } : op)) {
    cs.warn({
      code: 'W_OPTION_IGNORED',
      message: isEventSub ? `Trigger options are ignored for eventSubProcess ${id}: no trigger given` : `Trigger options are ignored for ${def.kind} ${id}`,
      element: id,
      hint: isEventSub
        ? 'Use eventSubProcess:<trigger> or --error/--message/--timer/... to create the start event with the sub-process.'
        : `Trigger options apply to events only${takesMessage(def) ? ' (a send / receive task takes --message)' : ''}.`,
    });
  }
  if (op.collapsed && def.family !== 'subProcess') {
    cs.warn({ code: 'W_OPTION_IGNORED', message: `--collapsed is ignored for ${def.kind} ${id}`, element: id, hint: '--collapsed applies to sub-processes only.' });
  }

  const entry = { id, kind: def.kind, ...(op.name ? { name: op.name } : {}), detail: placementDetail(doc, op) };
  cs.create(entry);
  // before the placement: a splice may rename the flow op.flow names
  const inherited: InheritedLane = explicitLane ? {} : inheritedLane(doc, op);
  const entryFlow = placeNode(doc, el, op, cs);
  warnIgnoredFlowOptions(doc, op, el, entryFlow, cs);
  if (op.flowAs) {
    // the flow the flow options describe: into the node, or out of it when `before` prepended it
    const flow = entryFlow ?? (placementMode(op) === 'before' ? doc.outgoing(el)[0] : undefined);
    if (!flow) {
      throw usageError(`flowAs ${op.flowAs}: ${id} gets no flow from this placement (${placementMode(op) === 'none' ? 'no placement' : `--${placementMode(op)}`})`, {
        element: id,
        hint: 'Place the node with after / before / flow, or connect it with a connect op that has "as".',
      });
    }
    cs.bind(op.flowAs, flow);
  }

  if (isEvent) {
    let resolved = trigger ?? inferTrigger(op);
    if (!resolved) {
      const scope = doc.scopeOf(el);
      if (is(el, 'bpmn:BoundaryEvent')) {
        throw modelError('E_TRIGGER_REQUIRED', `Boundary event ${id} needs a trigger`, {
          element: id,
          candidates: def.triggers ?? [],
          hint: `Use boundaryEvent:<trigger>, e.g. boundaryEvent:timer --timer P2D or boundaryEvent:error --error PaymentFailed.`,
        });
      }
      if (is(el, 'bpmn:StartEvent') && isEventSubProcess(scope)) {
        throw modelError('E_TRIGGER_REQUIRED', `Start event ${id} inside event sub-process ${idOf(scope!)} needs a trigger`, {
          element: id,
          candidates: (def.triggers ?? []).filter((t) => t !== 'none'),
          hint: 'Use startEvent:<trigger>, e.g. startEvent:error --error PaymentFailed or startEvent:timer --timer R/PT1H.',
        });
      }
      resolved = 'none';
    }
    reportNewRoots(doc, cs, () => applyTrigger(doc, el, resolved, op));
    if (resolved !== 'none') entry.kind = kindLabel(el);
  }
  if (messageTask) setTaskMessage(doc, el, op.message ?? '', cs);
  if (zeebeUserTaskDefault(doc, el)) cs.note(`${id} is a Camunda user task (zeebe:userTask), like Camunda Modeler creates them`);
  // a flow out of an event-based gateway the new node now ends or starts (checked once the trigger is set)
  for (const f of new Set([...doc.incoming(el), ...doc.outgoing(el)])) warnEventGatewayFlow(doc, f, cs);
  if (op.collapsed && def.family === 'subProcess') {
    requestCollapse(doc, id);
    cs.note(`${id} will be laid out collapsed`);
  }
  addDocumentation(doc, el, op.doc);

  if (explicitLane) {
    assignLane(doc, el, explicitLane, cs);
  } else {
    const scope = doc.scopeOf(el);
    if (inherited.lane && scope && is(scope, 'bpmn:Process')) {
      assignLane(doc, el, inherited.lane, cs);
      const warning = laneInheritedWarning(id, inherited);
      if (warning) cs.warn(warning);
    }
  }
  if (startTrigger) {
    const startCs = addElement(doc, { op: 'add', kind: `startEvent:${startTrigger}`, in: id, ...triggerOptionsOf(op) });
    const start = startCs.created[0];
    if (start) start.detail = `start of event sub-process ${id}`;
    cs.merge(startCs);
  }
  return el;
}

/* ------------------------------------------------------------------ */
/* entry point                                                          */
/* ------------------------------------------------------------------ */

/** Creates one element according to `op` and returns what changed; `idContext` is the context of an unnamed element's id when the placement does not tell it (split: `After <anchor>`). */
export function addElement(doc: Doc, op: AddOp, idContext?: string): ChangeSet {
  const cs = new ChangeSet();
  const { def, trigger } = resolveKind(op.kind);

  if (op.ifAbsent && !op.id) {
    const base = doc.idStyle.derivedBase(elementRequest(doc, def, trigger, op));
    throw usageError('--if-absent needs an explicit --id to check for', {
      hint: `Pass --id ${base} (the id add generates${op.name ? ` for "${op.name}"` : ''}), or drop --if-absent.`,
    });
  }
  if (op.ifAbsent && op.id && doc.has(op.id)) {
    const existing = doc.get(op.id)!;
    cs.note(`${op.id} already exists (${kindLabel(existing)}); nothing to do`);
    cs.bind(op.as, existing);
    if (op.flowAs) cs.bind(op.flowAs, doc.incoming(existing)[0]);
    bindRefAs(cs, op.refAs, existing);
    if (kindLabel(existing) !== def.kind && !kindLabel(existing).startsWith(`${def.kind}:`)) {
      cs.warn({
        code: 'W_KIND_MISMATCH',
        message: `${op.id} exists but is a ${kindLabel(existing)}, not a ${def.kind}`,
        element: op.id,
        hint: 'Use `retype` to change its kind, or pick another id.',
      });
    }
    return cs;
  }

  let el: El;
  switch (def.family) {
    case 'participant': {
      rejectPlacement(op, [], 'participant');
      const before = new Set(doc.processes());
      el = createParticipant(doc, op, cs);
      // platform defaults for the process a new pool brings (C7: history time to live)
      for (const p of doc.processes()) if (!before.has(p)) doc.initProcess(p);
      break;
    }
    case 'lane':
      rejectPlacement(op, ['in'], 'lane');
      el = createLane(doc, op, cs);
      break;
    case 'data': {
      rejectPlacement(op, ['in', 'to'], def.kind);
      const scope = doc.requireScope(op.in);
      const opts = { ...(op.id ? { id: op.id } : {}), ...(op.name ? { name: op.name } : {}) };
      el = def.kind === 'dataStore' ? createDataStore(doc, scope, opts, cs) : createDataObject(doc, scope, opts, cs);
      if (op.to) createDataAssociation(doc, el, doc.require(op.to), {}, cs);
      break;
    }
    case 'artifact': {
      rejectPlacement(op, ['in', 'to'], def.kind);
      const scope = doc.requireScope(op.in);
      const text = op.text ?? op.name;
      el = createTextAnnotation(doc, scope, { ...(op.id ? { id: op.id } : {}), ...(op.name ? { name: op.name } : {}), ...(text ? { text } : {}) }, cs);
      if (op.to) createAssociation(doc, doc.require(op.to), el, {}, cs);
      break;
    }
    default:
      el = addFlowNode(doc, op, def, trigger, cs, idContext);
      break;
  }

  if (!FLOW_NODE_FAMILIES.has(def.family)) {
    addDocumentation(doc, el, op.doc);
    if (op.lane) {
      cs.warn({ code: 'W_OPTION_IGNORED', message: `--lane is ignored for ${def.kind} ${idOf(el)}`, element: idOf(el), hint: 'Only flow nodes can be lane members.' });
    }
  }
  if (op.set && Object.keys(op.set).length) {
    cs.merge(setProperties(doc, { op: 'set', id: idOf(el), values: op.set }));
  }
  cs.bind(op.as, el);
  bindRefAs(cs, op.refAs, el);
  doc.reportSuffixed(cs);
  doc.invalidate();
  return cs;
}
