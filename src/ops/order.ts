/**
 * `order`: set the order of a node's outgoing sequence flows (= top-to-bottom
 * branch order in the diagram; the layouter follows declaration order).
 *
 * CONTRACT (implemented in the "mutation" work package):
 *  - op.flows must all be outgoing flows of op.id (E_NOT_OUTGOING); unlisted
 *    flows keep their relative order after the listed ones.
 *  - rewrites node.outgoing AND the declaration order of the flows in the
 *    scope's flowElements (flows stay after the node, in the new order).
 *
 * Lanes: with `op.lanes` (or lane ids in `op.flows`) the lanes of op.id are
 * ordered top to bottom instead: op.id is a process, a participant (its
 * process) or a lane (its child lanes); every listed id must be a direct
 * child lane of it (E_NOT_CHILD_LANE); unlisted lanes follow in their old
 * order. Rewrites `laneSet.lanes`. A kept diagram gets its bands reordered in
 * the diagram phase (src/diagram/ops.ts, orderBands).
 */
import type { Doc } from '../document.js';
import { modelError, usageError } from '../errors.js';
import { insertInto, is, many, removeFrom, type El } from '../model.js';
import { ChangeSet } from '../result.js';
import { changeOf, idOf } from './set.js';
import type { OrderOp } from './types.js';

/** Whether an order op orders lanes (explicit `lanes`, or lane ids given as `flows`). */
export function ordersLanes(doc: Doc, op: OrderOp): boolean {
  if (op.lanes?.length) return true;
  const first = op.flows?.[0];
  return !!first && is(doc.get(first), 'bpmn:Lane');
}

/** The lane set whose lanes `owner` orders: a process's (first), a participant's process's, a lane's child lanes. */
export function laneSetOf(owner: El): El | undefined {
  if (is(owner, 'bpmn:Lane')) return owner.get<El | undefined>('childLaneSet');
  const process = is(owner, 'bpmn:Participant') ? owner.get<El | undefined>('processRef') : owner;
  if (!process) return undefined;
  return (process.get<El[] | undefined>('laneSets') ?? [])[0];
}

/** Reorders the lanes of a process / participant / parent lane (see module contract). */
function orderLanes(doc: Doc, op: OrderOp): ChangeSet {
  const cs = new ChangeSet();
  const owner = doc.require(op.id, ['bpmn:Process', 'bpmn:Participant', 'bpmn:Lane'], 'process, participant or lane');
  const ids = op.lanes ?? op.flows ?? [];
  const set = laneSetOf(owner);
  const lanes = set ? many(set, 'lanes') : [];
  const listed: El[] = [];
  for (const id of ids) {
    const lane = doc.require(id, 'bpmn:Lane', 'lane');
    if (!lanes.includes(lane)) {
      throw modelError('E_NOT_CHILD_LANE', `${id} is not a direct child lane of ${idOf(owner)}`, {
        element: idOf(owner),
        related: [id],
        candidates: lanes.map(idOf),
        hint: lanes.length
          ? `Lanes of ${idOf(owner)} (top to bottom): ${lanes.map(idOf).join(', ')}. Nested lanes are ordered with their parent lane as id.`
          : `${idOf(owner)} has no lanes. Order the lanes of a pool by the participant (or process) id, nested lanes by their parent lane id.`,
      });
    }
    if (listed.includes(lane)) throw usageError(`Lane ${id} is listed twice`, { element: idOf(owner) });
    listed.push(lane);
  }
  const ordered = [...listed, ...lanes.filter((l) => !listed.includes(l))];
  if (ordered.every((l, i) => lanes[i] === l)) {
    cs.note(`${idOf(owner)}: lanes already in this order`);
    return cs;
  }
  lanes.splice(0, lanes.length, ...ordered);
  doc.invalidate();
  cs.change(changeOf(owner, `lane order: ${ordered.map(idOf).join(', ')}`));
  return cs;
}

/** Reorders the outgoing flows of a node, or lanes (see module contract). */
export function orderFlows(doc: Doc, op: OrderOp): ChangeSet {
  if (ordersLanes(doc, op)) return orderLanes(doc, op);
  const cs = new ChangeSet();
  const node = doc.require(op.id, 'bpmn:FlowNode');
  if (!op.flows?.length) throw usageError('order needs the flow ids in the wanted order', { element: op.id });
  const outgoing = doc.outgoing(node);
  const listed: El[] = [];
  for (const flowId of op.flows) {
    const flow = doc.require(flowId, 'bpmn:SequenceFlow', 'sequence flow');
    if (!outgoing.includes(flow)) {
      throw modelError('E_NOT_OUTGOING', `${flowId} is not an outgoing flow of ${idOf(node)}`, {
        element: idOf(node),
        related: [flowId],
        candidates: outgoing.map(idOf),
        hint: `Outgoing flows of ${idOf(node)}: ${outgoing.map(idOf).join(', ') || 'none'}.`,
      });
    }
    if (listed.includes(flow)) throw usageError(`Flow ${flowId} is listed twice`, { element: idOf(node) });
    listed.push(flow);
  }
  const ordered = [...listed, ...outgoing.filter((f) => !listed.includes(f))];
  const unchanged = ordered.every((f, i) => outgoing[i] === f);
  if (unchanged) {
    cs.note(`${idOf(node)}: outgoing flows already in this order`);
    return cs;
  }
  rewriteOutgoing(node, ordered);
  redeclare(doc, node, ordered);
  doc.invalidate();
  cs.change(changeOf(node, `outgoing order: ${ordered.map(idOf).join(', ')}`));
  return cs;
}

/** Rewrites node.outgoing in the new order (non-sequence-flow entries, if any, stay last). */
function rewriteOutgoing(node: El, ordered: El[]): void {
  const list = many(node, 'outgoing');
  const others = list.filter((f) => !is(f, 'bpmn:SequenceFlow'));
  list.splice(0, list.length, ...ordered, ...others);
}

/**
 * Re-declares the flows in the scope's flowElements in the new order: at the
 * position of the first of them, or right after the node when they were
 * declared before it.
 */
function redeclare(doc: Doc, node: El, ordered: El[]): void {
  const scope = doc.scopeOf(node) ?? (node.$parent as El | undefined);
  if (!scope) return;
  const list = many(scope, 'flowElements');
  const positions = ordered.map((f) => list.indexOf(f)).filter((i) => i >= 0);
  const nodeIndex = list.indexOf(node);
  let at = positions.length ? Math.min(...positions) : list.length;
  for (const f of ordered) removeFrom(scope, 'flowElements', f);
  const nodeIndexAfter = list.indexOf(node);
  if (nodeIndex !== -1 && at <= nodeIndex) at = nodeIndexAfter + 1;
  insertInto(scope, 'flowElements', Math.min(at, list.length), ...ordered);
}
