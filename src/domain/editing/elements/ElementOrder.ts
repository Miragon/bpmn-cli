import type { EditSession } from '../../document/EditSession.js';
import { modelError, usageError } from '../../document/utils/errors.js';
import { insertInto, is, many, removeFrom, type El } from '../../document/utils/moddle.js';
import { ChangeSet } from '../../document/ChangeSet.js';
import { idOf } from '../../document/utils/elements.js';
import { laneSetOf } from '../../document/utils/lanes.js';
import type { ReorderElements } from '../../commands/types.js';
import { ReorderTarget } from '../../commands/ReorderTarget.js';

/**
 * The `order` op: the top-to-bottom order of a node's outgoing flows, of lanes or of pools.
 * The layouter follows declaration order, so flows are re-declared too; unlisted entries
 * follow in their old order.
 */
export class ElementOrder {
  constructor(private readonly edit: EditSession) {}

  reorder(command: ReorderElements): ChangeSet {
    const target = new ReorderTarget(this.edit.doc, command);
    if (target.ordersPools()) return this.orderPools(command);
    if (target.ordersLanes()) return this.orderLanes(command);
    return this.orderOutgoing(command);
  }

  private orderPools(command: ReorderElements): ChangeSet {
    const doc = this.edit.doc;
    const changes = new ChangeSet();
    const collab = this.edit.require(command.id, 'bpmn:Collaboration', 'collaboration');
    const ids = command.pools ?? command.flows ?? [];
    if (!ids.length) {
      throw usageError('order needs the participant ids in the wanted top-to-bottom order', { element: command.id });
    }
    const participants = many(collab, 'participants');
    const listed: El[] = [];
    for (const id of ids) {
      const participant = this.edit.require(id, 'bpmn:Participant', 'participant (pool)');
      if (!participants.includes(participant)) {
        throw modelError('E_NOT_PARTICIPANT', `${id} is not a participant of ${idOf(collab)}`, {
          element: idOf(collab),
          related: [id],
          candidates: participants.map(idOf),
          hint: `Pools of ${idOf(collab)} (in declaration order): ${participants.map(idOf).join(', ')}.`,
        });
      }
      if (listed.includes(participant)) {
        throw usageError(`Participant ${id} is listed twice`, { element: idOf(collab) });
      }
      listed.push(participant);
    }
    const ordered = [...listed, ...participants.filter((participant) => !listed.includes(participant))];
    if (ordered.every((participant, index) => participants[index] === participant)) {
      changes.note(`${idOf(collab)}: pools already declared in this order (the drawing follows it)`);
      return changes;
    }
    participants.splice(0, participants.length, ...ordered);
    doc.invalidate();
    changes.change(ChangeSet.entryOf(collab, `pool order: ${ordered.map(idOf).join(', ')}`));
    return changes;
  }

  private orderLanes(command: ReorderElements): ChangeSet {
    const doc = this.edit.doc;
    const changes = new ChangeSet();
    const owner = this.edit.require(command.id, ['bpmn:Process', 'bpmn:Participant', 'bpmn:Lane'], 'process, participant or lane');
    const ids = command.lanes ?? command.flows ?? [];
    const set = laneSetOf(owner);
    const lanes = set ? many(set, 'lanes') : [];
    const listed: El[] = [];
    for (const id of ids) {
      const lane = this.edit.require(id, 'bpmn:Lane', 'lane');
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
      if (listed.includes(lane)) {
        throw usageError(`Lane ${id} is listed twice`, { element: idOf(owner) });
      }
      listed.push(lane);
    }
    const ordered = [...listed, ...lanes.filter((lane) => !listed.includes(lane))];
    if (ordered.every((lane, index) => lanes[index] === lane)) {
      changes.note(`${idOf(owner)}: lanes already in this order`);
      return changes;
    }
    lanes.splice(0, lanes.length, ...ordered);
    doc.invalidate();
    changes.change(ChangeSet.entryOf(owner, `lane order: ${ordered.map(idOf).join(', ')}`));
    return changes;
  }

  private orderOutgoing(command: ReorderElements): ChangeSet {
    const doc = this.edit.doc;
    const changes = new ChangeSet();
    const node = this.edit.require(command.id, 'bpmn:FlowNode');
    if (!command.flows?.length) {
      throw usageError('order needs the flow ids in the wanted order', { element: command.id });
    }
    const outgoing = doc.outgoing(node);
    const listed: El[] = [];
    for (const flowId of command.flows) {
      const flow = this.edit.require(flowId, 'bpmn:SequenceFlow', 'sequence flow');
      if (!outgoing.includes(flow)) {
        throw modelError('E_NOT_OUTGOING', `${flowId} is not an outgoing flow of ${idOf(node)}`, {
          element: idOf(node),
          related: [flowId],
          candidates: outgoing.map(idOf),
          hint: `Outgoing flows of ${idOf(node)}: ${outgoing.map(idOf).join(', ') || 'none'}.`,
        });
      }
      if (listed.includes(flow)) {
        throw usageError(`Flow ${flowId} is listed twice`, { element: idOf(node) });
      }
      listed.push(flow);
    }
    const ordered = [...listed, ...outgoing.filter((flow) => !listed.includes(flow))];
    const unchanged = ordered.every((flow, index) => outgoing[index] === flow);
    if (unchanged) {
      changes.note(`${idOf(node)}: outgoing flows already in this order`);
      return changes;
    }
    ElementOrder.rewriteOutgoing(node, ordered);
    this.redeclare(node, ordered);
    doc.invalidate();
    changes.change(ChangeSet.entryOf(node, `outgoing order: ${ordered.map(idOf).join(', ')}`));
    return changes;
  }

  /** Non-sequence-flow entries, if any, stay last. */
  private static rewriteOutgoing(node: El, ordered: El[]): void {
    const list = many(node, 'outgoing');
    const others = list.filter((flowElement) => !is(flowElement, 'bpmn:SequenceFlow'));
    list.splice(0, list.length, ...ordered, ...others);
  }

  /** At the position of the first of them, or right after the node when declared before it. */
  private redeclare(node: El, ordered: El[]): void {
    const scope = this.edit.doc.scopeOf(node) ?? (node.$parent as El | undefined);
    if (!scope) return;
    const list = many(scope, 'flowElements');
    const positions = ordered.map((flow) => list.indexOf(flow)).filter((position) => position >= 0);
    const nodeIndex = list.indexOf(node);
    let at = positions.length ? Math.min(...positions) : list.length;
    for (const flow of ordered) {
      removeFrom(scope, 'flowElements', flow);
    }
    const nodeIndexAfter = list.indexOf(node);
    if (nodeIndex !== -1 && at <= nodeIndex) at = nodeIndexAfter + 1;
    insertInto(scope, 'flowElements', Math.min(at, list.length), ...ordered);
  }
}
