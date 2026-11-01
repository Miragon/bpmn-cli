import { type BpmnElement, BpmnError, ChangeEntries, ChangeSet } from '../model/index.js';
import { type OrderOperation, ReorderTarget } from '../operations/index.js';
import type { Pools } from './containers/Pools.js';
import type { LaneMembership } from './LaneMembership.js';
import type { EditSession } from './session/EditSession.js';

export class ElementOrder {
  constructor(private readonly edit: EditSession) {}

  reorder(command: OrderOperation): ChangeSet {
    const target = new ReorderTarget(this.edit.document, command);
    if (target.ordersPools()) {
      return this.orderPools(command);
    }
    if (target.ordersLanes()) {
      return this.orderLanes(command);
    }
    return this.orderOutgoing(command);
  }

  private orderPools(command: OrderOperation): ChangeSet {
    const document = this.edit.document;
    const changes = new ChangeSet();
    const collab = this.edit.require(command.id, 'bpmn:Collaboration', 'collaboration');
    const ids = command.pools ?? command.flows ?? [];
    if (!ids.length) {
      throw BpmnError.usage('order needs the participant ids in the wanted top-to-bottom order', { element: command.id });
    }
    const participants = collab.list('participants');
    const listed: BpmnElement[] = [];
    for (const id of ids) {
      const participant = this.edit.require(id, 'bpmn:Participant', 'participant (pool)');
      if (!participants.includes(participant)) {
        throw BpmnError.model('E_NOT_PARTICIPANT', `${id} is not a participant of ${collab.id}`, {
          element: collab.id,
          related: [id],
          candidates: participants.map((element) => element.id),
          hint: `Pools of ${collab.id} (in declaration order): ${participants.map((element) => element.id).join(', ')}.`,
        });
      }
      if (listed.includes(participant)) {
        throw BpmnError.usage(`Participant ${id} is listed twice`, { element: collab.id });
      }
      listed.push(participant);
    }
    const ordered = [...listed, ...participants.filter((participant) => !listed.includes(participant))];
    if (ordered.every((participant, index) => participants[index] === participant)) {
      changes.note(`${collab.id}: pools already declared in this order (the drawing follows it)`);
      return changes;
    }
    collab.set('participants', ordered);
    document.tree.invalidate();
    changes.change(ChangeEntries.of(collab, `pool order: ${ordered.map((element) => element.id).join(', ')}`));
    return changes;
  }

  private orderLanes(command: OrderOperation): ChangeSet {
    const document = this.edit.document;
    const changes = new ChangeSet();
    const owner = this.edit.require(command.id, ['bpmn:Process', 'bpmn:Participant', 'bpmn:Lane'], 'process, participant or lane');
    const ids = command.lanes ?? command.flows ?? [];
    const set = document.scopes.laneSetOf(owner);
    const lanes = set ? set.list('lanes') : [];
    const listed: BpmnElement[] = [];
    for (const id of ids) {
      const lane = this.edit.require(id, 'bpmn:Lane', 'lane');
      if (!lanes.includes(lane)) {
        throw BpmnError.model('E_NOT_CHILD_LANE', `${id} is not a direct child lane of ${owner.id}`, {
          element: owner.id,
          related: [id],
          candidates: lanes.map((element) => element.id),
          hint: lanes.length
            ? `LaneMembership of ${owner.id} (top to bottom): ${lanes.map((element) => element.id).join(', ')}. Nested lanes are ordered with their parent lane as id.`
            : `${owner.id} has no lanes. Order the lanes of a pool by the participant (or process) id, nested lanes by their parent lane id.`,
        });
      }
      if (listed.includes(lane)) {
        throw BpmnError.usage(`Lane ${id} is listed twice`, { element: owner.id });
      }
      listed.push(lane);
    }
    const ordered = [...listed, ...lanes.filter((lane) => !listed.includes(lane))];
    if (ordered.every((lane, index) => lanes[index] === lane)) {
      changes.note(`${owner.id}: lanes already in this order`);
      return changes;
    }
    set!.set('lanes', ordered);
    document.tree.invalidate();
    changes.change(ChangeEntries.of(owner, `lane order: ${ordered.map((element) => element.id).join(', ')}`));
    return changes;
  }

  private orderOutgoing(command: OrderOperation): ChangeSet {
    const document = this.edit.document;
    const changes = new ChangeSet();
    const node = this.edit.require(command.id, 'bpmn:FlowNode');
    if (!command.flows?.length) {
      throw BpmnError.usage('order needs the flow ids in the wanted order', { element: command.id });
    }
    const outgoing = document.flows.outgoing(node);
    const listed: BpmnElement[] = [];
    for (const flowId of command.flows) {
      const flow = this.edit.require(flowId, 'bpmn:SequenceFlow', 'sequence flow');
      if (!outgoing.includes(flow)) {
        throw BpmnError.model('E_NOT_OUTGOING', `${flowId} is not an outgoing flow of ${node.id}`, {
          element: node.id,
          related: [flowId],
          candidates: outgoing.map((element) => element.id),
          hint: `Outgoing flows of ${node.id}: ${outgoing.map((element) => element.id).join(', ') || 'none'}.`,
        });
      }
      if (listed.includes(flow)) {
        throw BpmnError.usage(`Flow ${flowId} is listed twice`, { element: node.id });
      }
      listed.push(flow);
    }
    const ordered = [...listed, ...outgoing.filter((flow) => !listed.includes(flow))];
    const unchanged = ordered.every((flow, index) => outgoing[index] === flow);
    if (unchanged) {
      changes.note(`${node.id}: outgoing flows already in this order`);
      return changes;
    }
    ElementOrder.rewriteOutgoing(node, ordered);
    this.redeclare(node, ordered);
    document.tree.invalidate();
    changes.change(ChangeEntries.of(node, `outgoing order: ${ordered.map((element) => element.id).join(', ')}`));
    return changes;
  }

  private static rewriteOutgoing(node: BpmnElement, ordered: BpmnElement[]): void {
    const others = node.list('outgoing').filter((flowElement) => !flowElement.is('bpmn:SequenceFlow'));
    node.set('outgoing', [...ordered, ...others]);
  }

  private redeclare(node: BpmnElement, ordered: BpmnElement[]): void {
    const scope = this.edit.document.scopes.scopeOf(node) ?? node.parent;
    if (!scope) {
      return;
    }
    const list = scope.list('flowElements');
    const positions = ordered.map((flow) => list.indexOf(flow)).filter((position) => position >= 0);
    const nodeIndex = list.indexOf(node);
    let at = positions.length ? Math.min(...positions) : list.length;
    for (const flow of ordered) {
      scope.remove('flowElements', flow);
    }
    const nodeIndexAfter = list.indexOf(node);
    if (nodeIndex !== -1 && at <= nodeIndex) {
      at = nodeIndexAfter + 1;
    }
    scope.insert('flowElements', Math.min(at, list.length), ...ordered);
  }
}
