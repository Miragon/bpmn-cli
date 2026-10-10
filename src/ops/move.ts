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
 *
 * Conventions:
 *  - several ids with --after/--before/--flow are chained in the given order
 *    (X -> a -> b -> ...); with --in they are appended together and flows
 *    between them survive (re-declared in the new scope).
 *  - lane membership is dropped when the node leaves its process or enters
 *    a sub-process; after --after/--before/--flow into another process the
 *    node inherits the anchor's lane. --on re-attaches a boundary event.
 */
import type { Doc } from '../document.js';
import { modelError, usageError } from '../errors.js';
import { kindLabel } from '../kinds.js';
import { addTo, is, removeFrom, walk, type El } from '../model.js';
import { ChangeSet } from '../result.js';
import { assignLane } from './containers.js';
import { carryAssociations, flowChange, insertAfterInScope, placeNode, placementMode, placementScope, redirectFlow, removeSequenceFlow, renamedNote, warnEventGatewayFlow, type PlacementOptions } from './flows.js';
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
    let prev: El | undefined;
    for (const node of nodes) {
      moveNode(doc, node, prev ? { after: idOf(prev) } : placement, cs);
      prev = node;
    }
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
        hint: 'Connect the node again inside its new scope with `bpmn connect <source> <target>`.',
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
  cs.change({ ...flowChange(inFlow), detail: `${idOf(predecessor)} -> ${idOf(successor)} (bridged ${via})${renamedNote(renamed)}` });
  cs.note(`bridged: ${idOf(predecessor)} -> ${idOf(successor)}`);
}

/** --after / --before / --flow: detach, then place like a new node. */
function moveNode(doc: Doc, node: El, p: PlacementOptions, cs: ChangeSet): void {
  if (is(node, 'bpmn:BoundaryEvent')) {
    throw modelError('E_INVALID_PLACEMENT', `Boundary event ${idOf(node)} is moved with --on <activityId>`, { element: idOf(node) });
  }
  const anchors = anchorsOf(doc, p);
  for (const a of anchors) assertNotInside(node, a);
  const oldScope = doc.scopeOf(node);
  const targetScope = placementScope(doc, p);
  const boundaries = is(node, 'bpmn:Activity') ? doc.boundaryEventsOf(node) : [];
  const flowIds = [...doc.incoming(node), ...doc.outgoing(node)].map(idOf);
  detachWithBridge(doc, node, true, cs, undefined, 'move');
  reserveIds(doc, flowIds);
  leaveScope(doc, [node, ...boundaries], oldScope, targetScope, cs);
  placeNode(doc, node, p, cs);
  // the new place may give an event-based gateway a target BPMN 2.0 does not allow (like add / connect)
  for (const f of new Set([...doc.incoming(node), ...doc.outgoing(node)])) warnEventGatewayFlow(doc, f, cs);
  if (boundaries.length) insertAfterInScope(targetScope, node, ...boundaries);
  fixFlows(doc, boundaries, targetScope, cs);
  if (oldScope !== targetScope) inheritLane(doc, node, boundaries, anchors[0], targetScope);
  cs.change(changeOf(node, `moved ${describePlacement(p)}`));
  doc.invalidate();
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
