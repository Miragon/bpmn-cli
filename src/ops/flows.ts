/**
 * Sequence flows and node placement. This is the one place that knows the
 * placement grammar (--after / --before / --flow / --in / --on) and the
 * declaration-order conventions the layouter depends on.
 *
 * Associations on flows (e.g. a text annotation attached to a sequence
 * flow): when bridging replaces a flow by its predecessor flow, the
 * associations move along (carryAssociations, reported as changes); a flow
 * removed with a ChangeSet takes its associations with it (reported as
 * removed), so no association is ever left pointing at a removed flow.
 */
import type { Doc } from '../document.js';
import { modelError } from '../errors.js';
import { kindLabel, triggerOf } from '../kinds.js';
import { addTo, insertInto, is, many, removeFrom, type El } from '../model.js';
import type { ChangeSet } from '../result.js';
import type { FlowOptions, Placement } from './types.js';

export interface FlowAttrs {
  id?: string;
  name?: string;
  condition?: string;
  language?: string;
  isDefault?: boolean;
}

function idOf(el: El): string {
  return el.get<string>('id');
}

function label(el: El): string {
  const name = el.get<string | undefined>('name');
  return `${kindLabel(el)} ${idOf(el)}${name ? ` "${name}"` : ''}`;
}

export function flowChange(flow: El): { id: string; kind: string; name?: string; detail: string } {
  const src = flow.get<El | undefined>('sourceRef');
  const tgt = flow.get<El | undefined>('targetRef');
  const name = flow.get<string | undefined>('name');
  return {
    id: idOf(flow),
    kind: 'sequenceFlow',
    ...(name ? { name } : {}),
    detail: `${src ? idOf(src) : '?'} -> ${tgt ? idOf(tgt) : '?'}`,
  };
}

/* ------------------------------------------------------------------ */
/* declaration order                                                    */
/* ------------------------------------------------------------------ */

/** Inserts elements into a scope's flowElements right after `anchor` (or at the end). */
export function insertAfterInScope(scope: El, anchor: El | undefined, ...els: El[]): void {
  const list = many(scope, 'flowElements');
  for (const el of els) removeFrom(scope, 'flowElements', el);
  const idx = anchor ? list.indexOf(anchor) : -1;
  insertInto(scope, 'flowElements', idx === -1 ? list.length : idx + 1, ...els);
}

/** Inserts elements right before `anchor` (or at the end). */
export function insertBeforeInScope(scope: El, anchor: El | undefined, ...els: El[]): void {
  const list = many(scope, 'flowElements');
  for (const el of els) removeFrom(scope, 'flowElements', el);
  const idx = anchor ? list.indexOf(anchor) : -1;
  insertInto(scope, 'flowElements', idx === -1 ? list.length : idx, ...els);
}

/* ------------------------------------------------------------------ */
/* flow endpoints                                                       */
/* ------------------------------------------------------------------ */

function isEventSubProcess(el: El): boolean {
  return is(el, 'bpmn:SubProcess') && !!el.get<boolean | undefined>('triggeredByEvent');
}

/** True when the node may have outgoing sequence flows. */
export function canBeFlowSource(node: El): boolean {
  return is(node, 'bpmn:FlowNode') && !is(node, 'bpmn:EndEvent') && !isEventSubProcess(node);
}

/** True when the node may have incoming sequence flows. */
export function canBeFlowTarget(node: El): boolean {
  return is(node, 'bpmn:FlowNode') && !is(node, 'bpmn:StartEvent') && !is(node, 'bpmn:BoundaryEvent') && !isEventSubProcess(node);
}

/** The kind-based part of the endpoint rules (no scope check). */
export function assertFlowNodeRoles(source: El, target: El): void {
  if (!is(source, 'bpmn:FlowNode')) {
    throw modelError('E_INVALID_SOURCE', `${label(source)} cannot be the source of a sequence flow`, { element: idOf(source) });
  }
  if (!is(target, 'bpmn:FlowNode')) {
    throw modelError('E_INVALID_TARGET', `${label(target)} cannot be the target of a sequence flow`, { element: idOf(target) });
  }
  if (is(source, 'bpmn:EndEvent')) {
    throw modelError('E_INVALID_SOURCE', `End event ${idOf(source)} cannot have outgoing sequence flows`, { element: idOf(source) });
  }
  if (is(target, 'bpmn:StartEvent')) {
    throw modelError('E_INVALID_TARGET', `Start event ${idOf(target)} cannot have incoming sequence flows`, { element: idOf(target) });
  }
  if (is(target, 'bpmn:BoundaryEvent')) {
    throw modelError('E_INVALID_TARGET', `Boundary event ${idOf(target)} cannot have incoming sequence flows`, { element: idOf(target) });
  }
  if (is(source, 'bpmn:SubProcess') && source.get<boolean | undefined>('triggeredByEvent')) {
    throw modelError('E_INVALID_SOURCE', `Event sub-process ${idOf(source)} cannot have sequence flows`, { element: idOf(source) });
  }
  if (is(target, 'bpmn:SubProcess') && target.get<boolean | undefined>('triggeredByEvent')) {
    throw modelError('E_INVALID_TARGET', `Event sub-process ${idOf(target)} cannot have sequence flows`, { element: idOf(target) });
  }
}

export function assertSequenceFlowEndpoints(doc: Doc, source: El, target: El): void {
  assertFlowNodeRoles(source, target);
  const sScope = doc.scopeOf(source);
  const tScope = doc.scopeOf(target);
  if (!sScope || !tScope || sScope !== tScope) {
    throw modelError(
      'E_CROSS_SCOPE',
      `Sequence flows cannot cross scopes: ${idOf(source)} is in ${sScope ? idOf(sScope) : '?'}, ${idOf(target)} in ${tScope ? idOf(tScope) : '?'}`,
      {
        element: idOf(source),
        related: [idOf(target)],
        hint: 'Use a message flow between pools, or move the node with `bpmn move <id> --in <scope>`.',
      },
    );
  }
}

/* ------------------------------------------------------------------ */
/* event-based gateway targets                                          */
/* ------------------------------------------------------------------ */

/** Triggers an event-based gateway may wait for (an intermediate catch event with one of them). */
const EVENT_GATEWAY_TRIGGERS = ['message', 'timer', 'signal', 'conditional'];

/** Name of the message / signal a catch event waits for (the engines subscribe by name), else undefined. */
function subscriptionOf(event: El): { kind: 'message' | 'signal'; name: string } | undefined {
  const trigger = triggerOf(event);
  if (trigger !== 'message' && trigger !== 'signal') return undefined;
  const def = (event.get<El[] | undefined>('eventDefinitions') ?? [])[0];
  const ref = def?.get<El | undefined>(trigger === 'message' ? 'messageRef' : 'signalRef');
  if (!ref) return undefined;
  return { kind: trigger, name: ref.get<string | undefined>('name') ?? idOf(ref) };
}

/**
 * Why `target` cannot become the target of a new sequence flow from the
 * event-based gateway `gateway` (undefined = it can). The rules of Camunda 7,
 * CIB seven and Operaton (each rejects the deployment otherwise):
 *  - only an intermediateCatchEvent with a message, timer, signal or
 *    conditional trigger (not a receive task, task, end or throw event, plain
 *    or link catch event);
 *  - it has no other incoming sequence flow (also not a second one from the
 *    gateway);
 *  - no two branches wait for the same message name or signal name.
 * `leaving` are flows that disappear with the change (the flow into `target`
 * that a bridge replaces, the gateway's flow it re-points).
 */
export function eventGatewayTargetProblem(doc: Doc, gateway: El, target: El, leaving: El[] = []): string | undefined {
  if (!is(target, 'bpmn:IntermediateCatchEvent')) {
    return `${label(target)} is not an intermediate catch event; an event-based gateway can only lead to message, timer, signal or conditional catch events`;
  }
  const trigger = triggerOf(target) ?? 'none';
  if (!EVENT_GATEWAY_TRIGGERS.includes(trigger)) {
    return `${label(target)} is a ${trigger === 'none' ? 'plain' : trigger} catch event; an event-based gateway can only wait for a message, timer, signal or condition`;
  }
  const others = doc.incoming(target).filter((f) => !leaving.includes(f));
  if (others.length) {
    return `${label(target)} already has the incoming flow ${others.map(idOf).join(', ')}; a catch event after an event-based gateway can have no other incoming flow`;
  }
  const mine = subscriptionOf(target);
  if (mine) {
    for (const f of doc.outgoing(gateway)) {
      if (leaving.includes(f)) continue;
      const t = f.get<El | undefined>('targetRef');
      if (!t || t === target) continue;
      const theirs = subscriptionOf(t);
      if (theirs && theirs.kind === mine.kind && theirs.name === mine.name) {
        return `${idOf(t)} on another branch of ${idOf(gateway)} already waits for the ${mine.kind} "${mine.name}"; the engines allow one subscription per ${mine.kind} name and gateway`;
      }
    }
  }
  return undefined;
}

/* ------------------------------------------------------------------ */
/* create / remove / redirect                                           */
/* ------------------------------------------------------------------ */

function conditionExpression(doc: Doc, expr: string, language?: string): El {
  return doc.moddle.create('bpmn:FormalExpression', { body: expr, ...(language ? { language } : {}) });
}

export function assertCondition(expr: string | undefined): void {
  if (expr !== undefined && !expr.trim()) {
    throw modelError('E_INVALID_VALUE', 'The condition expression is empty', {
      hint: 'Shell expansion may have eaten it: quote expressions with single quotes, e.g. --condition \'${ok}\'.',
    });
  }
}

/**
 * Creates a sequence flow source -> target, maintains incoming/outgoing and
 * declaration order (the flow is declared right after its source unless
 * `declareAfter` says otherwise).
 */
export function createSequenceFlow(doc: Doc, source: El, target: El, attrs: FlowAttrs = {}, declareAfter?: El): El {
  assertSequenceFlowEndpoints(doc, source, target);
  assertCondition(attrs.condition);
  const scope = doc.scopeOf(source)!;
  let id = attrs.id;
  if (id) doc.claimId(id);
  else id = doc.newId('Flow');
  const flow = doc.create('bpmn:SequenceFlow', {
    id,
    ...(attrs.name ? { name: attrs.name } : {}),
    sourceRef: source,
    targetRef: target,
    ...(attrs.condition ? { conditionExpression: conditionExpression(doc, attrs.condition, attrs.language) } : {}),
  });
  addTo(source, 'outgoing', flow);
  addTo(target, 'incoming', flow);
  insertAfterInScope(scope, declareAfter ?? lastFlowOf(scope, source) ?? source, flow);
  if (attrs.isDefault) setDefaultFlow(doc, flow, true);
  doc.invalidate();
  return flow;
}

/** The last declared outgoing flow of `source` inside `scope` (keeps branch order tidy). */
function lastFlowOf(scope: El, source: El): El | undefined {
  const list = many(scope, 'flowElements');
  let last: El | undefined;
  for (const el of list) {
    if (is(el, 'bpmn:SequenceFlow') && el.get<El | undefined>('sourceRef') === source) last = el;
  }
  return last;
}

/** Associations (e.g. of text annotations) attached to a flow. */
function associationsOf(doc: Doc, flow: El): El[] {
  return [...doc.byId().values()].filter((a) => is(a, 'bpmn:Association') && (a.get<El | undefined>('sourceRef') === flow || a.get<El | undefined>('targetRef') === flow));
}

/** Re-attaches the associations of `from` to `to` (bridging: the annotation stays on the flow that replaces `from`). */
export function carryAssociations(doc: Doc, from: El, to: El, cs: ChangeSet): void {
  for (const a of associationsOf(doc, from)) {
    for (const end of ['sourceRef', 'targetRef']) if (a.get<El | undefined>(end) === from) a.set(end, to);
    cs.change({ id: idOf(a), kind: 'association', detail: `re-attached from ${idOf(from)} to ${idOf(to)}` });
  }
  doc.invalidate();
}

/** Removes the associations attached to a flow that is being removed (reported). */
function dropAssociations(doc: Doc, flow: El, cs: ChangeSet): void {
  for (const a of associationsOf(doc, flow)) {
    const parent = a.$parent as El | undefined;
    if (parent) removeFrom(parent, 'artifacts', a);
    doc.ids.release(idOf(a));
    cs.remove({ id: idOf(a), kind: 'association' });
  }
  doc.invalidate();
}

/**
 * Removes a sequence flow from its scope and from every mirror list of the
 * scope's nodes: its endpoints' and stale entries a modeler file may carry on
 * other nodes (which would otherwise dangle). With a ChangeSet, the
 * associations attached to it are removed too (reported); without one the
 * caller resolves them (remove's cascade).
 */
export function removeSequenceFlow(doc: Doc, flow: El, cs?: ChangeSet): void {
  if (cs) dropAssociations(doc, flow, cs);
  const source = flow.get<El | undefined>('sourceRef');
  if (source && source.get<El | undefined>('default') === flow) source.set('default', undefined);
  const scope = flow.$parent as El | undefined;
  const nodes = scope ? many(scope, 'flowElements').filter((n) => is(n, 'bpmn:FlowNode')) : [];
  for (const node of new Set([source, flow.get<El | undefined>('targetRef'), ...nodes])) {
    if (!node) continue;
    removeFrom(node, 'outgoing', flow);
    removeFrom(node, 'incoming', flow);
  }
  if (scope) removeFrom(scope, 'flowElements', flow);
  doc.ids.release(idOf(flow));
  doc.invalidate();
}

export function redirectFlow(doc: Doc, flow: El, ends: { source?: El; target?: El }): void {
  const source = ends.source ?? flow.get<El>('sourceRef');
  const target = ends.target ?? flow.get<El>('targetRef');
  assertSequenceFlowEndpoints(doc, source, target);
  const oldSource = flow.get<El | undefined>('sourceRef');
  const oldTarget = flow.get<El | undefined>('targetRef');
  if (oldSource && oldSource !== source) {
    removeFrom(oldSource, 'outgoing', flow);
    if (oldSource.get<El | undefined>('default') === flow) oldSource.set('default', undefined);
  }
  if (oldTarget && oldTarget !== target) removeFrom(oldTarget, 'incoming', flow);
  flow.set('sourceRef', source);
  flow.set('targetRef', target);
  addTo(source, 'outgoing', flow);
  addTo(target, 'incoming', flow);
  doc.invalidate();
}

export function setDefaultFlow(doc: Doc, flow: El, isDefault: boolean): void {
  const source = flow.get<El>('sourceRef');
  if (isDefault) {
    if (!is(source, 'bpmn:ExclusiveGateway') && !is(source, 'bpmn:InclusiveGateway') && !is(source, 'bpmn:ComplexGateway') && !is(source, 'bpmn:Activity')) {
      throw modelError('E_INVALID_DEFAULT', `Only exclusive/inclusive gateways and activities can have a default flow (${idOf(source)} is a ${kindLabel(source)})`, {
        element: idOf(flow),
      });
    }
    source.set('default', flow);
    if (flow.get<El | undefined>('conditionExpression')) flow.set('conditionExpression', undefined);
  } else if (source.get<El | undefined>('default') === flow) {
    source.set('default', undefined);
  }
  doc.invalidate();
}

export function setFlowCondition(doc: Doc, flow: El, expr: string | undefined, language?: string): void {
  assertCondition(expr);
  if (expr) {
    flow.set('conditionExpression', conditionExpression(doc, expr, language));
    const source = flow.get<El | undefined>('sourceRef');
    if (source?.get<El | undefined>('default') === flow) source.set('default', undefined);
  } else {
    flow.set('conditionExpression', undefined);
  }
  doc.invalidate();
}

/* ------------------------------------------------------------------ */
/* splice / detach                                                      */
/* ------------------------------------------------------------------ */

/**
 * Inserts `node` into `flow` (A -> B becomes A -> node -> B). The original
 * flow keeps its id and attributes and now ends at `node`; a new plain flow
 * node -> B is created.
 */
export function spliceIntoFlow(doc: Doc, flow: El, node: El): { first: El; second: El } {
  const target = flow.get<El>('targetRef');
  const scope = doc.scopeOf(flow)!;
  const source = flow.get<El>('sourceRef');
  // never produce an invalid model: both new flows must be legal before anything is touched
  assertFlowNodeRoles(source, node);
  assertFlowNodeRoles(node, target);
  // declaration order: node right after the original flow's source, then the flows
  insertAfterInScope(scope, lastFlowOf(scope, source) ?? source, node);
  removeFrom(target, 'incoming', flow);
  flow.set('targetRef', node);
  addTo(node, 'incoming', flow);
  const second = createSequenceFlow(doc, node, target, {}, node);
  doc.invalidate();
  return { first: flow, second };
}

/**
 * Removes every sequence flow of `node`. With `bridge`, a node with exactly
 * one incoming and one outgoing flow is bypassed: the incoming flow is
 * retargeted to the successor (label/condition of the outgoing flow are
 * carried over when the incoming flow has none).
 */
export function detachNode(doc: Doc, node: El, bridge: boolean, cs: ChangeSet): void {
  const incoming = doc.incoming(node);
  const outgoing = doc.outgoing(node);
  if (bridge && incoming.length === 1 && outgoing.length === 1) {
    const inFlow = incoming[0]!;
    const outFlow = outgoing[0]!;
    const successor = outFlow.get<El>('targetRef');
    const predecessor = inFlow.get<El>('sourceRef');
    if (successor !== node && predecessor !== node) {
      const outName = outFlow.get<string | undefined>('name');
      const outCond = outFlow.get<El | undefined>('conditionExpression');
      if (outName && !inFlow.get<string | undefined>('name')) inFlow.set('name', outName);
      else if (outName) cs.warn({ code: 'W_LABEL_DROPPED', message: `Flow label "${outName}" of ${idOf(outFlow)} was dropped while bridging ${idOf(node)}`, element: idOf(outFlow) });
      if (outCond && !inFlow.get<El | undefined>('conditionExpression')) inFlow.set('conditionExpression', outCond);
      else if (outCond) cs.warn({ code: 'W_CONDITION_DROPPED', message: `Condition of ${idOf(outFlow)} was dropped while bridging ${idOf(node)}`, element: idOf(outFlow) });
      carryAssociations(doc, outFlow, inFlow, cs);
      removeSequenceFlow(doc, outFlow, cs);
      cs.remove(flowChange(outFlow));
      redirectFlow(doc, inFlow, { target: successor });
      cs.change({ ...flowChange(inFlow), detail: `${idOf(predecessor)} -> ${idOf(successor)} (bridged ${idOf(node)})` });
      cs.note(`bridged: ${idOf(predecessor)} -> ${idOf(successor)}`);
      return;
    }
  }
  // a self-loop is both incoming and outgoing: remove and report it once
  for (const f of new Set([...incoming, ...outgoing])) {
    cs.remove(flowChange(f));
    removeSequenceFlow(doc, f, cs);
  }
}

/* ------------------------------------------------------------------ */
/* placement                                                            */
/* ------------------------------------------------------------------ */

export type PlacementOptions = Placement & FlowOptions & { to?: string };

/**
 * A compensation handler (isForCompensation=true) cannot carry boundary
 * events: Camunda 7, CIB seven and Operaton reject the deployment ("Invalid
 * reference in boundary event").
 */
export function assertBoundaryHost(host: El, boundary?: El): void {
  if (host.get<boolean | undefined>('isForCompensation')) {
    throw modelError('E_INVALID_HOST', `${label(host)} is a compensation handler (isForCompensation=true); it cannot carry boundary events`, {
      element: boundary ? idOf(boundary) : idOf(host),
      related: [idOf(host)],
      hint: `Attach the boundary event to the activity that is compensated, or make ${idOf(host)} a normal activity first (\`bpmn set <file> ${idOf(host)} isForCompensation=false\`).`,
    });
  }
}

function requireFlowBetween(doc: Doc, a: El, b: El): El {
  const flows = doc.outgoing(a).filter((f) => f.get<El | undefined>('targetRef') === b);
  if (flows.length === 1) return flows[0]!;
  if (!flows.length) {
    throw modelError('E_NO_FLOW', `There is no sequence flow ${idOf(a)} -> ${idOf(b)}`, { element: idOf(a), related: [idOf(b)] });
  }
  throw modelError('E_AMBIGUOUS_FLOW', `There are ${flows.length} flows ${idOf(a)} -> ${idOf(b)}; use --flow <flowId>`, {
    element: idOf(a),
    candidates: flows.map(idOf),
  });
}

/** Which placement flags are set. */
export function placementMode(p: Placement): 'after' | 'before' | 'between' | 'flow' | 'in' | 'on' | 'none' {
  if (p.after && p.before) return 'between';
  if (p.after) return 'after';
  if (p.before) return 'before';
  if (p.flow) return 'flow';
  if (p.on) return 'on';
  if (p.in) return 'in';
  return 'none';
}

/** The scope a placement targets (without mutating anything). */
export function placementScope(doc: Doc, p: Placement): El {
  const mode = placementMode(p);
  switch (mode) {
    case 'after':
    case 'between':
      return doc.scopeOf(doc.require(p.after!, 'bpmn:FlowNode')) ?? doc.defaultScope();
    case 'before':
      return doc.scopeOf(doc.require(p.before!, 'bpmn:FlowNode')) ?? doc.defaultScope();
    case 'flow':
      return doc.scopeOf(doc.require(p.flow!, 'bpmn:SequenceFlow', 'sequence flow')) ?? doc.defaultScope();
    case 'on':
      return doc.scopeOf(doc.require(p.on!, 'bpmn:Activity', 'activity')) ?? doc.defaultScope();
    case 'in':
      return doc.requireScope(p.in);
    default:
      return doc.defaultScope();
  }
}

function applyFlowOptions(doc: Doc, flow: El, opts: FlowOptions, cs: ChangeSet): void {
  let touched = false;
  if (opts.flowName !== undefined) {
    flow.set('name', opts.flowName || undefined);
    touched = true;
  }
  if (opts.condition !== undefined) {
    setFlowCondition(doc, flow, opts.condition, opts.language);
    touched = true;
  }
  if (opts.default) {
    setDefaultFlow(doc, flow, true);
    touched = true;
  }
  if (touched) cs.change(flowChange(flow));
}

const FLOW_OPTION_FLAGS: Array<[keyof FlowOptions, string]> = [
  ['flowName', '--flow-name'],
  ['flowId', '--flow-id'],
  ['condition', '--condition'],
  ['language', '--language'],
  ['default', '--default'],
];

function usedFlowOptions(p: FlowOptions): string[] {
  return FLOW_OPTION_FLAGS.filter(([key]) => p[key] !== undefined && p[key] !== false).map(([, flag]) => flag);
}

/**
 * Refuses to splice a node that cannot sit inside a flow (start / end events,
 * event sub-processes) with an error that names the way out.
 */
function assertSpliceable(doc: Doc, node: El, flow: El): void {
  const src = flow.get<El>('sourceRef');
  const tgt = flow.get<El>('targetRef');
  const scope = doc.scopeOf(flow);
  const scopeId = scope ? idOf(scope) : '<scope>';
  const kind = kindLabel(node);
  if (!canBeFlowSource(node)) {
    throw modelError('E_INVALID_PLACEMENT', `${kind} ${idOf(node)} cannot be inserted into the flow ${idOf(src)} -> ${idOf(tgt)}: it cannot have outgoing sequence flows`, {
      element: idOf(node),
      related: [idOf(flow)],
      hint: `${idOf(src)} already flows to ${idOf(tgt)}. Create the ${kind} unconnected and branch to it: \`bpmn add <file> ${kind} "<name>" --in ${scopeId}\` then \`bpmn connect <file> ${idOf(src)} <newId>\`, or split ${idOf(src)} with a gateway (\`apply\` op "split").`,
    });
  }
  if (!canBeFlowTarget(node)) {
    throw modelError('E_INVALID_PLACEMENT', `${kind} ${idOf(node)} cannot be inserted into the flow ${idOf(src)} -> ${idOf(tgt)}: it cannot have incoming sequence flows`, {
      element: idOf(node),
      related: [idOf(flow)],
      hint: `${idOf(tgt)} already has the predecessor ${idOf(src)}. Create the ${kind} unconnected: \`bpmn add <file> ${kind} "<name>" --in ${scopeId}\` then \`bpmn connect <file> <newId> ${idOf(tgt)}\`.`,
    });
  }
}

/**
 * Splices `node` into `flow` and reports it. `flow` (now source -> node) is
 * the flow into the node, so it takes the flow options; it keeps its id
 * (`add` warns when --flow-id was given for it).
 */
function spliceWithOptions(doc: Doc, node: El, flow: El, p: PlacementOptions, cs: ChangeSet): El {
  assertSpliceable(doc, node, flow);
  const src = flow.get<El>('sourceRef');
  const tgt = flow.get<El>('targetRef');
  const { second } = spliceIntoFlow(doc, flow, node);
  cs.create(flowChange(second));
  cs.change({ ...flowChange(flow), detail: `${idOf(src)} -> ${idOf(node)} (was -> ${idOf(tgt)})` });
  cs.note(`inserted between ${idOf(src)} and ${idOf(tgt)}`);
  applyFlowOptions(doc, flow, p, cs);
  return flow;
}

/**
 * Places a flow node according to the placement grammar. The node must not
 * yet be connected. Boundary events use `on`. Returns the flow into the node
 * (if any) so callers can report it.
 *
 * Rules for `after X`:
 *   - X is a gateway or has no outgoing flow  -> append: X -> node
 *   - X has exactly one outgoing flow          -> splice into it: X -> node -> old target
 *   - otherwise                                -> E_HAS_SUCCESSOR (use --flow)
 * `before Y` is symmetric (join gateways / nodes without incoming flow get node -> Y).
 */
export function placeNode(doc: Doc, node: El, p: PlacementOptions, cs: ChangeSet): El | undefined {
  const mode = placementMode(p);
  const scope = placementScope(doc, p);
  let entryFlow: El | undefined;

  if (mode === 'on') {
    const host = doc.require(p.on!, 'bpmn:Activity', 'activity');
    if (!is(node, 'bpmn:BoundaryEvent')) {
      throw modelError('E_INVALID_PLACEMENT', `--on attaches boundary events only; ${kindLabel(node)} cannot be attached to ${idOf(host)}`, {
        element: idOf(node),
        hint: 'Use --after / --before / --in for other nodes.',
      });
    }
    assertBoundaryHost(host, node);
    node.set('attachedToRef', host);
    const boundaries = doc.boundaryEventsOf(host);
    insertAfterInScope(scope, boundaries[boundaries.length - 1] ?? host, node);
    cs.note(`attached to ${idOf(host)}`);
  } else if (is(node, 'bpmn:BoundaryEvent')) {
    throw modelError('E_INVALID_PLACEMENT', 'Boundary events must be placed with --on <activityId>', { element: idOf(node) });
  } else if (mode === 'in' || mode === 'none') {
    insertAfterInScope(scope, undefined, node);
  } else if (mode === 'flow') {
    const flow = doc.require(p.flow!, 'bpmn:SequenceFlow', 'sequence flow');
    entryFlow = spliceWithOptions(doc, node, flow, p, cs);
  } else if (mode === 'between') {
    const a = doc.require(p.after!, 'bpmn:FlowNode');
    const b = doc.require(p.before!, 'bpmn:FlowNode');
    const flow = requireFlowBetween(doc, a, b);
    entryFlow = spliceWithOptions(doc, node, flow, p, cs);
  } else if (mode === 'after') {
    const anchor = doc.require(p.after!, 'bpmn:FlowNode');
    const out = doc.outgoing(anchor);
    if (is(anchor, 'bpmn:Gateway') || out.length === 0) {
      insertAfterInScope(scope, lastFlowOf(scope, anchor) ?? anchor, node);
      entryFlow = createSequenceFlow(doc, anchor, node, flowAttrs(p), node);
      cs.create(flowChange(entryFlow));
      cs.note(`appended after ${idOf(anchor)}`);
    } else if (out.length === 1) {
      entryFlow = spliceWithOptions(doc, node, out[0]!, p, cs);
    } else {
      throw modelError('E_HAS_SUCCESSOR', `${idOf(anchor)} already has ${out.length} outgoing flows; say which one to insert into`, {
        element: idOf(anchor),
        candidates: out.map(idOf),
        hint: `Use --flow <flowId> (one of ${out.map(idOf).join(', ')}) or --after ${idOf(anchor)} --before <targetId>.`,
      });
    }
  } else if (mode === 'before') {
    const anchor = doc.require(p.before!, 'bpmn:FlowNode');
    const inc = doc.incoming(anchor);
    const isJoin = is(anchor, 'bpmn:Gateway') && inc.length >= 2;
    if (inc.length === 0 || isJoin) {
      // prepend: no flow into the node exists; the flow options go to the one flow this creates (node -> anchor)
      insertBeforeInScope(scope, anchor, node);
      const flow = createSequenceFlow(doc, node, anchor, flowAttrs(p), node);
      cs.create(flowChange(flow));
      cs.note(`prepended before ${idOf(anchor)}`);
      const used = usedFlowOptions(p);
      if (used.length) {
        cs.note(`${used.join(', ')} applied to ${idOf(flow)} (${idOf(node)} -> ${idOf(anchor)}): ${idOf(anchor)} ${isJoin ? 'is a join gateway' : 'had no incoming flow'}, so no flow into ${idOf(node)} was created`);
      }
    } else if (inc.length === 1) {
      entryFlow = spliceWithOptions(doc, node, inc[0]!, p, cs);
    } else {
      throw modelError('E_HAS_PREDECESSOR', `${idOf(anchor)} already has ${inc.length} incoming flows; say which one to insert into`, {
        element: idOf(anchor),
        candidates: inc.map(idOf),
        hint: `Use --flow <flowId> (one of ${inc.map(idOf).join(', ')}) or --after <sourceId> --before ${idOf(anchor)}.`,
      });
    }
  }

  if (p.to) {
    const target = doc.require(p.to, 'bpmn:FlowNode');
    const flow = createSequenceFlow(doc, node, target, {}, undefined);
    cs.create(flowChange(flow));
    if (!is(target, 'bpmn:Gateway') && doc.incoming(target).length > 1) {
      cs.warn({
        code: 'W_IMPLICIT_JOIN',
        message: `${idOf(target)} now has ${doc.incoming(target).length} incoming flows (implicit join)`,
        element: idOf(target),
        hint: 'Consider joining through a gateway.',
      });
    }
  }
  doc.invalidate();
  return entryFlow;
}

function flowAttrs(p: FlowOptions): FlowAttrs {
  return {
    ...(p.flowId ? { id: p.flowId } : {}),
    ...(p.flowName ? { name: p.flowName } : {}),
    ...(p.condition ? { condition: p.condition } : {}),
    ...(p.language ? { language: p.language } : {}),
    ...(p.default ? { isDefault: true } : {}),
  };
}
