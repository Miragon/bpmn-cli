import { type BpmnElement, BpmnError, ChangeEntries, ChangeSet } from '../model/index.js';
import { type OrderOperation, ReorderTarget } from '../operations/index.js';
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

  private static listed(ids: readonly string[], noun: string, owner: BpmnElement, memberOf: (id: string) => BpmnElement): BpmnElement[] {
    const listed: BpmnElement[] = [];
    for (const id of ids) {
      const member = memberOf(id);
      if (listed.includes(member)) {
        throw BpmnError.usage(`${noun} ${id} is listed twice`, { element: owner.id });
      }
      listed.push(member);
    }
    return listed;
  }

  private static reordered(current: readonly BpmnElement[], listed: readonly BpmnElement[]): BpmnElement[] | undefined {
    const ordered = [...listed, ...current.filter((element) => !listed.includes(element))];
    return ordered.every((element, index) => current[index] === element) ? undefined : ordered;
  }

  private static idsOf(elements: readonly BpmnElement[]): string {
    return elements.map((element) => element.id).join(', ');
  }

  private orderPools(command: OrderOperation): ChangeSet {
    const changes = new ChangeSet();
    const collab = this.edit.require(command.id, 'bpmn:Collaboration', 'collaboration');
    const ids = command.pools ?? command.flows ?? [];
    if (!ids.length) {
      throw BpmnError.usage('order needs the participant ids in the wanted top-to-bottom order', { element: command.id });
    }
    const participants = collab.list('participants');
    const listed = ElementOrder.listed(ids, 'Participant', collab, (id) => {
      const participant = this.edit.require(id, 'bpmn:Participant', 'participant (pool)');
      if (!participants.includes(participant)) {
        throw BpmnError.model('E_NOT_PARTICIPANT', `${id} is not a participant of ${collab.id}`, {
          element: collab.id,
          related: [id],
          candidates: participants.map((element) => element.id),
          hint: `Pools of ${collab.id} (in declaration order): ${ElementOrder.idsOf(participants)}.`,
        });
      }
      return participant;
    });
    const ordered = ElementOrder.reordered(participants, listed);
    if (!ordered) {
      changes.note(`${collab.id}: pools already declared in this order (the drawing follows it)`);
      return changes;
    }
    collab.set('participants', ordered);
    this.edit.document.tree.invalidate();
    changes.change(ChangeEntries.of(collab, `pool order: ${ElementOrder.idsOf(ordered)}`));
    return changes;
  }

  private orderLanes(command: OrderOperation): ChangeSet {
    const changes = new ChangeSet();
    const owner = this.edit.require(command.id, ['bpmn:Process', 'bpmn:Participant', 'bpmn:Lane'], 'process, participant or lane');
    const set = this.edit.document.scopes.laneSetOf(owner);
    const lanes = set ? set.list('lanes') : [];
    const listed = ElementOrder.listed(command.lanes ?? command.flows ?? [], 'Lane', owner, (id) => {
      const lane = this.edit.require(id, 'bpmn:Lane', 'lane');
      if (!lanes.includes(lane)) {
        throw BpmnError.model('E_NOT_CHILD_LANE', `${id} is not a direct child lane of ${owner.id}`, {
          element: owner.id,
          related: [id],
          candidates: lanes.map((element) => element.id),
          hint: lanes.length
            ? `Lanes of ${owner.id} (top to bottom): ${ElementOrder.idsOf(lanes)}. Nested lanes are ordered with their parent lane as id.`
            : `${owner.id} has no lanes. Order the lanes of a pool by the participant (or process) id, nested lanes by their parent lane id.`,
        });
      }
      return lane;
    });
    const ordered = ElementOrder.reordered(lanes, listed);
    if (!ordered) {
      changes.note(`${owner.id}: lanes already in this order`);
      return changes;
    }
    set!.set('lanes', ordered);
    this.edit.document.tree.invalidate();
    changes.change(ChangeEntries.of(owner, `lane order: ${ElementOrder.idsOf(ordered)}`));
    return changes;
  }

  private orderOutgoing(command: OrderOperation): ChangeSet {
    const changes = new ChangeSet();
    const node = this.edit.require(command.id, 'bpmn:FlowNode');
    if (!command.flows?.length) {
      throw BpmnError.usage('order needs the flow ids in the wanted order', { element: command.id });
    }
    const outgoing = this.edit.document.flows.outgoing(node);
    const listed = ElementOrder.listed(command.flows, 'Flow', node, (flowId) => {
      const flow = this.edit.require(flowId, 'bpmn:SequenceFlow', 'sequence flow');
      if (!outgoing.includes(flow)) {
        throw BpmnError.model('E_NOT_OUTGOING', `${flowId} is not an outgoing flow of ${node.id}`, {
          element: node.id,
          related: [flowId],
          candidates: outgoing.map((element) => element.id),
          hint: `Outgoing flows of ${node.id}: ${ElementOrder.idsOf(outgoing) || 'none'}.`,
        });
      }
      return flow;
    });
    const ordered = ElementOrder.reordered(outgoing, listed);
    if (!ordered) {
      changes.note(`${node.id}: outgoing flows already in this order`);
      return changes;
    }
    ElementOrder.rewriteOutgoing(node, ordered);
    this.redeclare(node, ordered);
    this.edit.document.tree.invalidate();
    changes.change(ChangeEntries.of(node, `outgoing order: ${ElementOrder.idsOf(ordered)}`));
    return changes;
  }

  private static rewriteOutgoing(node: BpmnElement, ordered: BpmnElement[]): void {
    const others = node.list('outgoing').filter((flowElement) => !flowElement.is('bpmn:SequenceFlow'));
    node.set('outgoing', [...ordered, ...others]);
  }

  private redeclare(node: BpmnElement, ordered: BpmnElement[]): void {
    const scope = this.edit.document.scopes.scopeOf(node)!;
    const declared = scope.list('flowElements');
    const positions = ordered.map((flow) => declared.indexOf(flow)).filter((position) => position >= 0);
    const firstFlow = positions.length ? Math.min(...positions) : declared.length;
    const flowsLeadTheNode = firstFlow <= declared.indexOf(node);
    for (const flow of ordered) {
      scope.remove('flowElements', flow);
    }
    scope.insert('flowElements', flowsLeadTheNode ? scope.list('flowElements').indexOf(node) + 1 : firstFlow, ...ordered);
  }
}
