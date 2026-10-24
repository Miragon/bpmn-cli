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
 * the diagram phase (src/format/FormatOps.ts, orderBands).
 *
 * Pools: with `op.pools`, a collaboration as op.id (or participant ids in
 * `op.flows`) the participants of that collaboration are ordered top to
 * bottom instead (black-box pools included); every listed id must be one of
 * its participants (E_NOT_PARTICIPANT); unlisted pools follow in their old
 * order. Rewrites `collaboration.participants`; a kept diagram gets its pool
 * bands reordered in the diagram phase (src/format/FormatOps.ts, orderPools).
 */
import type { Doc } from '../model/Doc.js';
import { modelError, usageError } from '../shared/utils/errors.js';
import { insertInto, is, many, removeFrom, type El } from '../model/utils/moddle.js';
import { ChangeSet } from '../model/ChangeSet.js';
import { changeOf, idOf } from './set.js';
import { laneSetOf } from './utils/lanes.js';
import type { OrderOp } from './types.js';

export class Reordering {
  constructor(
    private readonly doc: Doc,
    private readonly op: OrderOp,
  ) {}

  /** Whether the op orders lanes (explicit `lanes`, or lane ids given as `flows`). */
  ordersLanes(): boolean {
    if (this.op.lanes?.length) return true;
    const first = this.op.flows?.[0];
    return !!first && is(this.doc.get(first), 'bpmn:Lane');
  }

  /** Whether the op orders pools (explicit `pools`, a collaboration as `id`, or participant ids given as `flows`). */
  ordersPools(): boolean {
    if (this.op.pools?.length) return true;
    if (is(this.doc.get(this.op.id), 'bpmn:Collaboration')) return true;
    const first = this.op.flows?.[0];
    return !!first && is(this.doc.get(first), 'bpmn:Participant');
  }

  /** Whether the op orders the bands of a drawing (lanes or pools): the diagram phase reorders them in a kept diagram. */
  ordersBands(): boolean {
    return this.ordersLanes() || this.ordersPools();
  }

  /** Reorders the outgoing flows of a node, or lanes, or pools (see module contract). */
  apply(): ChangeSet {
    if (this.ordersPools()) return this.orderPools();
    if (this.ordersLanes()) return this.orderLanes();
    return this.orderOutgoing();
  }

  private orderPools(): ChangeSet {
    const { doc, op } = this;
    const cs = new ChangeSet();
    const collab = doc.require(op.id, 'bpmn:Collaboration', 'collaboration');
    const ids = op.pools ?? op.flows ?? [];
    if (!ids.length) throw usageError('order needs the participant ids in the wanted top-to-bottom order', { element: op.id });
    const participants = many(collab, 'participants');
    const listed: El[] = [];
    for (const id of ids) {
      const p = doc.require(id, 'bpmn:Participant', 'participant (pool)');
      if (!participants.includes(p)) {
        throw modelError('E_NOT_PARTICIPANT', `${id} is not a participant of ${idOf(collab)}`, {
          element: idOf(collab),
          related: [id],
          candidates: participants.map(idOf),
          hint: `Pools of ${idOf(collab)} (in declaration order): ${participants.map(idOf).join(', ')}.`,
        });
      }
      if (listed.includes(p)) throw usageError(`Participant ${id} is listed twice`, { element: idOf(collab) });
      listed.push(p);
    }
    const ordered = [...listed, ...participants.filter((p) => !listed.includes(p))];
    if (ordered.every((p, i) => participants[i] === p)) {
      cs.note(`${idOf(collab)}: pools already declared in this order (the drawing follows it)`);
      return cs;
    }
    participants.splice(0, participants.length, ...ordered);
    doc.invalidate();
    cs.change(changeOf(collab, `pool order: ${ordered.map(idOf).join(', ')}`));
    return cs;
  }

  private orderLanes(): ChangeSet {
    const { doc, op } = this;
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

  private orderOutgoing(): ChangeSet {
    const { doc, op } = this;
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
    this.rewriteOutgoing(node, ordered);
    this.redeclare(node, ordered);
    doc.invalidate();
    cs.change(changeOf(node, `outgoing order: ${ordered.map(idOf).join(', ')}`));
    return cs;
  }

  /** Rewrites node.outgoing in the new order (non-sequence-flow entries, if any, stay last). */
  private rewriteOutgoing(node: El, ordered: El[]): void {
    const list = many(node, 'outgoing');
    const others = list.filter((f) => !is(f, 'bpmn:SequenceFlow'));
    list.splice(0, list.length, ...ordered, ...others);
  }

  /**
   * Re-declares the flows in the scope's flowElements in the new order: at the
   * position of the first of them, or right after the node when they were
   * declared before it.
   */
  private redeclare(node: El, ordered: El[]): void {
    const scope = this.doc.scopeOf(node) ?? (node.$parent as El | undefined);
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
}
