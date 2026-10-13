/**
 * `move`: relocate nodes.
 *
 * CONTRACT (implemented in the "mutation" work package):
 *  - op.lane (only): assignLane() for each node.
 *  - placement (after/before/flow): for each node: detachWithBridge(bridge=true),
 *    remove it from its current scope's flowElements, then placeNode() with
 *    the placement (which inserts it into the target scope). Boundary events
 *    of a moved activity move along. `in` moves into another scope without
 *    connecting: the moved group is bridged as a whole (one flow in, one flow
 *    out -> predecessor connected to successor), every other flow that would
 *    now cross scopes is removed (reported).
 *    The bridge of the old place follows remove's rule (E_INVALID_BRIDGE next
 *    to an event-based gateway); a new place behind an event-based gateway
 *    is warned about like add / connect (W_EVENT_GATEWAY_TARGET, plain files).
 *  - lane + placement may be combined.
 *  - ids of flows removed while moving stay claimed for the rest of the
 *    command, so a flow created by the placement never reuses one.
 *  - with flow ids kept (Doc.keepsFlowId, `--keep-flow-ids`) a moved node's one
 *    out-flow, which the detach takes out, is put back as the first flow the
 *    placement creates out of that node (the flow node -> successor of a
 *    splice, node -> anchor of a prepend, or node -> next node when the next
 *    one of the chain is appended to it, as always to a gateway: a gateway with
 *    a next node keeps it for that append), so it keeps its id, documentation
 *    and extensions and is reported as changed (W_FLOW_ID_STALE when its id
 *    named the old ends). Its name, condition and annotations stay with the
 *    bridge at the old place, and it is no longer a default flow; a node that
 *    is not bridged drops name and condition (W_LABEL_DROPPED /
 *    W_CONDITION_DROPPED), unless the flow ends between its old ends once the
 *    chain is placed (also when a later node of the chain takes it back there):
 *    then it gets them back, and its default marker, where the placement gave
 *    none; a default the placement gave the node wins (the change says the
 *    flow is no longer the default flow), and a flow the placement made the
 *    default flow gets no condition (W_CONDITION_DROPPED). A flowId for the
 *    flow a prepend creates (node -> anchor) makes a new flow instead. The
 *    chain runs through these flows, so a flow between moved nodes
 *    that matches it (a -> b of `move a b`) ends where it was, unless a has
 *    several out-flows; when the detach of b takes it out (b is not bridged: an
 *    end event, a join), the append of b after a puts it back with its name,
 *    condition and default marker. The flows nothing puts back stay removed:
 *    the out-flow of the last node appended after a gateway or a node without
 *    successor, the other flows of a node that is not bridged (several in- or
 *    out-flows, or none in or none out), and with --in the group's out-flow.
 *
 * Conventions:
 *  - several ids with --after/--before/--flow are chained in the given order
 *    (X -> a -> b -> ...); with --in they are appended together and flows
 *    between them survive (re-declared in the new scope).
 *  - lane membership is dropped when the node leaves its process or enters
 *    a sub-process; a node in a lane keeps it when it moves within its
 *    process (a note when the flow it went into runs between two other
 *    lanes). A node without a lane at its new place in a process (it came
 *    from a sub-process or another pool, or had none) inherits one with
 *    add's rule (lanes.ts inheritedLane: the anchor's; in a flow between two
 *    lanes the lane of the row the layout draws it on, W_LANE_INHERITED),
 *    unless op.lane names one. --on re-attaches a boundary event (it takes
 *    its host's lane).
 */
import type { Doc } from '../document.js';
import { modelError, usageError, type Warning } from '../errors.js';
import { kindLabel } from '../kinds.js';
import { addTo, is, removeFrom, walk, type El } from '../model.js';
import { ChangeSet } from '../result.js';
import { assignLane, laneOf } from './containers.js';
import { carryAssociations, flowChange, insertAfterInScope, placeNode, placementMode, placementScope, redirectFlow, removeSequenceFlow, renamedNote, warnEventGatewayFlow, type PlacementOptions } from './flows.js';
import { crossLaneNote, inheritedLane, laneInheritedWarning } from './lanes.js';
import { assertBridgeAllowed, canLoopToItself, detachWithBridge } from './remove.js';
import { changeOf, idOf } from './set.js';
import type { MoveOp } from './types.js';

/** Moves the nodes of `op.ids` (see module contract). */
export function moveElements(doc: Doc, op: MoveOp): ChangeSet {
  const cs = new ChangeSet();
  if (!op.ids?.length) throw usageError('move needs at least one node id');
  const mode = placementMode(op);
  const hasLane = op.lane !== undefined;
  if (mode === 'none' && !hasLane) {
    throw usageError('move needs a placement (--after, --before, --flow, --in, --on) and/or --lane <laneId>');
  }
  const nodes = op.ids.map((id) => doc.require(id, 'bpmn:FlowNode'));
  const placement = placementOf(op);
  if (mode === 'in') {
    moveInto(doc, nodes, placement, cs);
  } else if (mode === 'on') {
    for (const node of nodes) moveOnto(doc, node, placement, cs);
  } else if (mode !== 'none') {
    // with flow ids kept: the flows the detach took out, by the moved node they leave, until a placement puts them back
    const spare = new Map<El, SpareFlow>();
    const dropped: DroppedLabel[] = [];
    nodes.forEach((node, i) => {
      const prev = nodes[i - 1];
      dropped.push(...moveNode(doc, node, prev ? { after: idOf(prev) } : placement, cs, hasLane, spare, { prev, next: nodes[i + 1] }));
    });
    giveBackLate(doc, dropped, cs);
  }
  if (hasLane) {
    const lane = op.lane ? doc.require(op.lane, 'bpmn:Lane', 'lane') : undefined;
    for (const node of nodes) assignLane(doc, node, lane, cs);
  }
  doc.invalidate();
  return cs;
}

function placementOf(op: MoveOp): PlacementOptions {
  const p: PlacementOptions = {};
  if (op.after) p.after = op.after;
  if (op.before) p.before = op.before;
  if (op.flow) p.flow = op.flow;
  if (op.in) p.in = op.in;
  if (op.on) p.on = op.on;
  if (op.flowName !== undefined) p.flowName = op.flowName;
  if (op.flowId) p.flowId = op.flowId;
  if (op.condition !== undefined) p.condition = op.condition;
  if (op.language) p.language = op.language;
  if (op.default) p.default = true;
  return p;
}

function describePlacement(p: PlacementOptions): string {
  if (p.after && p.before) return `between ${p.after} and ${p.before}`;
  if (p.after) return `after ${p.after}`;
  if (p.before) return `before ${p.before}`;
  if (p.flow) return `into flow ${p.flow}`;
  if (p.on) return `onto ${p.on}`;
  return `into ${p.in ?? 'the process'}`;
}

/** Elements a placement refers to (for the "cannot move into itself" check and lane inheritance). */
function anchorsOf(doc: Doc, p: PlacementOptions): El[] {
  const out: El[] = [];
  if (p.after) out.push(doc.require(p.after, 'bpmn:FlowNode'));
  if (p.before) out.push(doc.require(p.before, 'bpmn:FlowNode'));
  if (p.flow) {
    const flow = doc.require(p.flow, 'bpmn:SequenceFlow', 'sequence flow');
    out.push(flow.get<El>('sourceRef'), flow.get<El>('targetRef'));
  }
  if (p.on) out.push(doc.require(p.on, 'bpmn:Activity', 'activity'));
  if (p.in) out.push(doc.requireScope(p.in));
  return out;
}

function assertNotInside(node: El, anchor: El): void {
  if (anchor === node || [...walk(node)].includes(anchor)) {
    throw modelError('E_INVALID_PLACEMENT', `${idOf(node)} cannot be moved relative to ${idOf(anchor)}: that is the node itself or one of its children`, {
      element: idOf(node),
      related: [idOf(anchor)],
      hint: 'Pick an anchor outside the moved node.',
    });
  }
}

function deepestLane(doc: Doc, el: El): El | undefined {
  const lanes = doc.lanesOf(el);
  return lanes[lanes.length - 1];
}

/**
 * Takes the node (and its boundary events) out of its current scope's
 * flowElements; lane membership is dropped when the process changes or the
 * target is a sub-process.
 */
function leaveScope(doc: Doc, moved: El[], oldScope: El | undefined, targetScope: El, cs: ChangeSet): void {
  const processChanged = !oldScope || doc.processOf(oldScope) !== doc.processOf(targetScope);
  const dropLanes = oldScope !== targetScope && (processChanged || !is(targetScope, 'bpmn:Process'));
  for (const n of moved) {
    if (dropLanes) {
      for (const lane of doc.lanesOf(n)) {
        removeFrom(lane, 'flowNodeRef', n);
        cs.change(changeOf(lane, `member ${idOf(n)} removed`));
      }
    }
    if (oldScope) removeFrom(oldScope, 'flowElements', n);
  }
}

/**
 * After nodes arrived in `scope`: flows between nodes of the scope are
 * re-declared there, flows to nodes elsewhere are removed and reported.
 */
function fixFlows(doc: Doc, moved: El[], scope: El, cs: ChangeSet): void {
  const seen = new Set<El>();
  for (const n of moved) {
    for (const flow of [...doc.incoming(n), ...doc.outgoing(n)]) {
      if (seen.has(flow)) continue;
      seen.add(flow);
      const src = flow.get<El>('sourceRef');
      const tgt = flow.get<El>('targetRef');
      if (doc.scopeOf(src) === scope && doc.scopeOf(tgt) === scope) {
        const declaredIn = flow.$parent as El | undefined;
        if (declaredIn !== scope) {
          if (declaredIn) removeFrom(declaredIn, 'flowElements', flow);
          insertAfterInScope(scope, src, flow);
        }
        continue;
      }
      removeSequenceFlow(doc, flow, cs);
      cs.remove(flowChange(flow));
      cs.warn({
        code: 'W_FLOW_DROPPED',
        message: `Sequence flow ${idOf(flow)} (${idOf(src)} -> ${idOf(tgt)}) was removed: it would cross scopes after the move`,
        element: idOf(flow),
        related: [idOf(src), idOf(tgt)],
        hint: 'Connect the node again inside its new scope with `bpmn connect <file> <source> <target>`.',
      });
    }
  }
}

function inheritLane(doc: Doc, node: El, boundaries: El[], anchor: El | undefined, scope: El): void {
  if (!anchor || !is(scope, 'bpmn:Process') || doc.lanesOf(node).length) return;
  const lane = deepestLane(doc, anchor);
  if (!lane) return;
  addTo(lane, 'flowNodeRef', node);
  for (const b of boundaries) if (!doc.lanesOf(b).length) addTo(lane, 'flowNodeRef', b);
}

/**
 * Keeps ids of flows removed during this command claimed: a flow the same
 * command creates afterwards must not reuse one, or the result would list the
 * id as both removed and created.
 */
function reserveIds(doc: Doc, ids: string[]): void {
  for (const id of ids) if (id && !doc.has(id)) doc.ids.claim(id);
}

/**
 * Before a group of nodes leaves its scope: when exactly one flow enters the
 * group from outside and exactly one leaves it, the outer predecessor is
 * connected straight to the outer successor (what detachNode's bridging does
 * for a single node). Exception paths of the group's boundary events are not
 * exits: they are dropped by fixFlows like with --after.
 */
function bridgeGroup(doc: Doc, group: El[], cs: ChangeSet): void {
  const inside = new Set<El>();
  for (const n of group) {
    inside.add(n);
    if (is(n, 'bpmn:Activity')) for (const b of doc.boundaryEventsOf(n)) inside.add(b);
  }
  const entries: El[] = [];
  const exits: El[] = [];
  for (const n of inside) {
    for (const f of doc.incoming(n)) if (!inside.has(f.get<El>('sourceRef'))) entries.push(f);
    if (is(n, 'bpmn:BoundaryEvent')) continue;
    for (const f of doc.outgoing(n)) if (!inside.has(f.get<El>('targetRef'))) exits.push(f);
  }
  if (entries.length !== 1 || exits.length !== 1) return;
  const inFlow = entries[0]!;
  const outFlow = exits[0]!;
  const predecessor = inFlow.get<El>('sourceRef');
  const successor = outFlow.get<El>('targetRef');
  if ((predecessor === successor && !canLoopToItself(predecessor)) || doc.scopeOf(predecessor) !== doc.scopeOf(successor)) return;
  const via = group.map(idOf).join(', ');
  assertBridgeAllowed(doc, outFlow.get<El>('sourceRef'), inFlow, outFlow, undefined, 'move', via);
  const outName = outFlow.get<string | undefined>('name');
  const outCond = outFlow.get<El | undefined>('conditionExpression');
  if (outName && !inFlow.get<string | undefined>('name')) inFlow.set('name', outName);
  else if (outName) cs.warn({ code: 'W_LABEL_DROPPED', message: `Flow label "${outName}" of ${idOf(outFlow)} was dropped while bridging ${via}`, element: idOf(outFlow) });
  const inFlowIsDefault = predecessor.get<El | undefined>('default') === inFlow;
  if (outCond && !inFlow.get<El | undefined>('conditionExpression') && !inFlowIsDefault) {
    inFlow.set('conditionExpression', outCond);
    outCond.$parent = inFlow;
  } else if (outCond) {
    cs.warn({ code: 'W_CONDITION_DROPPED', message: `Condition of ${idOf(outFlow)} was dropped while bridging ${via}`, element: idOf(outFlow) });
  }
  carryAssociations(doc, outFlow, inFlow, cs);
  removeSequenceFlow(doc, outFlow, cs);
  cs.remove(flowChange(outFlow));
  reserveIds(doc, [idOf(outFlow)]);
  const renamed = redirectFlow(doc, inFlow, { target: successor });
  cs.change(flowChange(inFlow, `${idOf(predecessor)} -> ${idOf(successor)} (bridged ${via})${renamedNote(renamed)}`));
  cs.note(`bridged: ${idOf(predecessor)} -> ${idOf(successor)}`);
}

/**
 * A flow the detach took out (flow ids kept), filed under the moved node it
 * leaves, and the target it had. `label`: the name, condition and default
 * marker no bridge took (the node was not bridged; for the flow from the node
 * moved before, the ones it has), given back when the flow is put back to
 * `target`, else dropped with W_LABEL_DROPPED / W_CONDITION_DROPPED.
 */
interface SpareFlow {
  flow: El;
  target: El;
  label?: FlowLabel;
}

interface FlowLabel {
  name: string | undefined;
  condition: El | undefined;
  isDefault: boolean;
}

function labelOf(flow: El, source: El): FlowLabel {
  return { name: flow.get<string | undefined>('name'), condition: flow.get<El | undefined>('conditionExpression'), isDefault: source.get<El | undefined>('default') === flow };
}

/**
 * A label a placement dropped (a spare flow put back to another node), with
 * the warnings that said so: a later node of the chain may take the flow
 * back between its old ends (`move a b`, a not bridged: a's splice puts
 * a -> b back elsewhere, b's splice after a ends it at b again).
 */
interface DroppedLabel {
  node: El;
  flow: El;
  target: El;
  label: FlowLabel;
  warnings: Warning[];
}

/**
 * --after / --before / --flow: detach, then place like a new node
 * (`explicitLane`: op.lane assigns the lane afterwards). `spare`: the flows
 * this move took out, for the placement to put back; `chain`: the nodes moved
 * before this one (it is placed after it) and after it.
 */
function moveNode(doc: Doc, node: El, p: PlacementOptions, cs: ChangeSet, explicitLane: boolean, spare: Map<El, SpareFlow>, chain: { prev?: El; next?: El } = {}): DroppedLabel[] {
  const { prev, next } = chain;
  if (is(node, 'bpmn:BoundaryEvent')) {
    throw modelError('E_INVALID_PLACEMENT', `Boundary event ${idOf(node)} is moved with --on <activityId>`, { element: idOf(node) });
  }
  const anchors = anchorsOf(doc, p);
  for (const a of anchors) assertNotInside(node, a);
  const oldScope = doc.scopeOf(node);
  const targetScope = placementScope(doc, p);
  const boundaries = is(node, 'bpmn:Activity') ? doc.boundaryEventsOf(node) : [];
  const incoming = doc.incoming(node);
  const outgoing = doc.outgoing(node);
  const flowIds = [...incoming, ...outgoing].map(idOf);
  // with flow ids kept: the node's one out-flow, which the detach takes out, is put back at the new place
  const oldOut = outgoing.length === 1 && outgoing[0]!.get<El>('targetRef') !== node && doc.keepsFlowId(outgoing[0]!) ? outgoing[0] : undefined;
  const oldTarget = oldOut?.get<El>('targetRef');
  const outLabel = oldOut && labelOf(oldOut, node);
  // ... and the flow from the node moved before (a -> b of `move a b`): when the detach takes it out (this node is not
  // bridged: an end event, a join), the append after that node puts it back as it was
  const fromPrev = prev && incoming.find((f) => f.get<El>('sourceRef') === prev && doc.keepsFlowId(f));
  const prevLabel = fromPrev && labelOf(fromPrev, prev!);
  const bridged = detachWithBridge(doc, node, true, cs, undefined, 'move');
  reserveIds(doc, flowIds);
  // a bridge took the out-flow's name and condition (or warned); without one nothing did
  if (oldOut && oldTarget && !doc.has(idOf(oldOut))) spare.set(node, { flow: oldOut, target: oldTarget, ...(bridged ? {} : { label: outLabel }) });
  if (fromPrev && !doc.has(idOf(fromPrev)) && !spare.has(prev!)) spare.set(prev!, { flow: fromPrev, target: node, label: prevLabel });
  const laneBefore = laneOf(doc, node);
  leaveScope(doc, [node, ...boundaries], oldScope, targetScope, cs);
  doc.invalidate();
  // the lane, decided before the placement (a splice may rename the flow): a node in a lane keeps it, one without inherits add's
  const own = laneBefore && (laneBefore.get<El[] | undefined>('flowNodeRef') ?? []).includes(node) ? laneBefore : undefined;
  const inherited = !explicitLane && is(targetScope, 'bpmn:Process') ? inheritedLane(doc, p) : {};
  // the next node of the chain is appended to a gateway (a new branch): the gateway's out-flow waits for that append
  const holdOwn = !!next && is(node, 'bpmn:Gateway');
  placeNode(doc, node, p, cs, (source) => (source === node && holdOwn ? undefined : spare.get(source)?.flow));
  const dropped = reportPutBack(doc, spare, cs);
  // the new place may give an event-based gateway a target BPMN 2.0 does not allow (like add / connect)
  for (const f of new Set([...doc.incoming(node), ...doc.outgoing(node)])) warnEventGatewayFlow(doc, f, cs);
  if (boundaries.length) insertAfterInScope(targetScope, node, ...boundaries);
  fixFlows(doc, boundaries, targetScope, cs);
  if (own) {
    const note = explicitLane ? undefined : crossLaneNote(idOf(node), own, inherited);
    if (note) cs.note(note);
  } else if (inherited.lane) {
    addTo(inherited.lane, 'flowNodeRef', node);
    for (const b of boundaries) if (!doc.lanesOf(b).length) addTo(inherited.lane, 'flowNodeRef', b);
    const warning = laneInheritedWarning(idOf(node), inherited);
    if (warning) cs.warn(warning);
  }
  cs.change(changeOf(node, `moved ${describePlacement(p)}`));
  doc.invalidate();
  return dropped;
}

/**
 * The spare flows a placement put back (flow ids kept): each is one changed
 * entry, `<node> -> <new target> (was -> <old target>)`, instead of the
 * removed entry of the detach and the created entry of the placement. A
 * flow back between its old ends gets the label no bridge took back
 * (giveBack); one with another target drops it: W_LABEL_DROPPED /
 * W_CONDITION_DROPPED, returned for giveBackLate.
 */
function reportPutBack(doc: Doc, spare: Map<El, SpareFlow>, cs: ChangeSet): DroppedLabel[] {
  const dropped: DroppedLabel[] = [];
  for (const [node, { flow, target, label }] of spare) {
    if (doc.get(idOf(flow)) !== flow) continue;
    spare.delete(node);
    const id = idOf(flow);
    const back = flow.get<El>('targetRef') === target;
    const lost = label && back ? giveBack(node, flow, label, cs) : '';
    cs.removed = cs.removed.filter((c) => c.id !== id);
    cs.created = cs.created.filter((c) => c.id !== id);
    cs.change(flowChange(flow, `${flowChange(flow).detail}${back ? lost : ` (was -> ${idOf(target)})`}`));
    if (!label || back) continue;
    const why = `while moving ${idOf(node)}: ${idOf(node)} was not bridged, so nothing at its old place took it, and ${id} was put back at its new place without it`;
    const warnings: Warning[] = [];
    if (label.name) warnings.push({ code: 'W_LABEL_DROPPED', message: `Flow label "${label.name}" of ${id} was dropped ${why}`, element: id });
    if (label.condition) warnings.push({ code: 'W_CONDITION_DROPPED', message: `Condition of ${id} was dropped ${why}`, element: id });
    for (const w of warnings) cs.warn(w);
    dropped.push({ node, flow, target, label, warnings });
  }
  return dropped;
}

/**
 * Gives a put-back flow, back between its old ends, the label no bridge
 * took: the name and condition where the placement gave none, the default
 * marker where its source has no other default and the flow no condition.
 * A flow the placement made the default flow gets no condition
 * (W_CONDITION_DROPPED: a default flow has none). Returns the detail for a
 * default marker that could not come back.
 */
function giveBack(node: El, flow: El, label: FlowLabel, cs: ChangeSet): string {
  const id = idOf(flow);
  if (label.name && !flow.get<string | undefined>('name')) flow.set('name', label.name);
  if (label.condition && !flow.get<El | undefined>('conditionExpression')) {
    if (node.get<El | undefined>('default') === flow) {
      cs.warn({
        code: 'W_CONDITION_DROPPED',
        message: `Condition of ${id} was dropped while moving ${idOf(node)}: ${id} is now the default flow of ${idOf(node)}`,
        element: id,
        hint: `A default flow has no condition; use \`bpmn set <file> ${id} condition=...\` if the condition should replace the default marker.`,
      });
    } else {
      flow.set('conditionExpression', label.condition);
      label.condition.$parent = flow;
    }
  }
  if (!label.isDefault || node.get<El | undefined>('default') === flow) return '';
  if (!node.get<El | undefined>('default') && !flow.get<El | undefined>('conditionExpression')) {
    node.set('default', flow);
    return '';
  }
  return ` (no longer the default flow of ${idOf(node)})`;
}

/**
 * After the whole chain is placed: a flow whose label a placement dropped
 * that ends between its old ends again (a later node of the chain took it
 * back) gets it back after all, and the warnings that said otherwise go.
 * It is listed once, as a flow back between its old ends.
 */
function giveBackLate(doc: Doc, dropped: DroppedLabel[], cs: ChangeSet): void {
  for (const { node, flow, target, label, warnings } of dropped) {
    if (doc.get(idOf(flow)) !== flow || flow.get<El>('sourceRef') !== node || flow.get<El>('targetRef') !== target) continue;
    cs.warnings = cs.warnings.filter((w) => !warnings.includes(w));
    const lost = giveBack(node, flow, label, cs);
    const change = flowChange(flow);
    cs.changed = cs.changed.filter((c) => c.id !== change.id);
    cs.change(flowChange(flow, `${change.detail}${lost}`));
  }
}

/** --in: append the nodes to the scope; the group is bridged, flows between its nodes survive, others are dropped. */
function moveInto(doc: Doc, nodes: El[], p: PlacementOptions, cs: ChangeSet): void {
  const scope = placementScope(doc, p);
  const relocating: El[] = [];
  for (const node of nodes) {
    if (is(node, 'bpmn:BoundaryEvent')) {
      throw modelError('E_INVALID_PLACEMENT', `Boundary event ${idOf(node)} is moved with --on <activityId>`, { element: idOf(node) });
    }
    assertNotInside(node, scope);
    if (doc.scopeOf(node) === scope) {
      cs.note(`${idOf(node)} is already in ${idOf(scope)}`);
      continue;
    }
    relocating.push(node);
  }
  bridgeGroup(doc, relocating, cs);
  const moved: El[] = [];
  for (const node of relocating) {
    const oldScope = doc.scopeOf(node);
    const boundaries = is(node, 'bpmn:Activity') ? doc.boundaryEventsOf(node) : [];
    leaveScope(doc, [node, ...boundaries], oldScope, scope, cs);
    insertAfterInScope(scope, undefined, node, ...boundaries);
    moved.push(node, ...boundaries);
    cs.change(changeOf(node, `moved into ${idOf(scope)}`));
  }
  fixFlows(doc, moved, scope, cs);
  doc.invalidate();
}

/** --on: re-attach a boundary event to another activity. */
function moveOnto(doc: Doc, node: El, p: PlacementOptions, cs: ChangeSet): void {
  if (!is(node, 'bpmn:BoundaryEvent')) {
    throw modelError('E_INVALID_PLACEMENT', `--on attaches boundary events only; ${kindLabel(node)} ${idOf(node)} is moved with --after/--before/--flow/--in`, {
      element: idOf(node),
    });
  }
  const host = doc.require(p.on!, 'bpmn:Activity', 'activity');
  const oldHost = node.get<El | undefined>('attachedToRef');
  if (oldHost === host) {
    cs.note(`${idOf(node)} is already attached to ${idOf(host)}`);
    return;
  }
  const oldScope = doc.scopeOf(node);
  const scope = doc.scopeOf(host) ?? doc.defaultScope();
  leaveScope(doc, [node], oldScope, scope, cs);
  placeNode(doc, node, { on: p.on! }, cs);
  fixFlows(doc, [node], scope, cs);
  inheritLane(doc, node, [], host, scope);
  cs.change(changeOf(node, `moved onto ${idOf(host)}${oldHost ? ` (was ${idOf(oldHost)})` : ''}`));
  doc.invalidate();
}
