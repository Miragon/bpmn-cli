import { type BpmnElement, BpmnError, type ChangeSet, ElementLabels, IdRequests, Kinds } from '../model/index.js';
import type { AddOperation } from '../operations/index.js';
import type { EditSession } from './session/EditSession.js';

export class LaneMembership {
  constructor(private readonly edit: EditSession) {}

  createLane(command: AddOperation, changes: ChangeSet): BpmnElement {
    const document = this.edit.document;
    const { process, parentLane } = this.resolveLaneContainer(command);
    const id = this.edit.allocator.explicitOr(command.id, IdRequests.kindRequest(Kinds.byName('lane')!, { ...(command.name ? { name: command.name } : {}), context: new ElementLabels(parentLane ?? process).context('In') }));
    const laneSet = parentLane ? this.ensureChildLaneSet(parentLane, changes) : this.ensureLaneSet(process, changes);
    const lane = document.tree.create('bpmn:Lane', { id, ...(command.name ? { name: command.name } : {}) });
    laneSet.add('lanes', lane);
    changes.create({ id, kind: 'lane', ...(command.name ? { name: command.name } : {}), detail: parentLane ? `in lane ${parentLane.id}` : `in ${process.id}` });
    let extra: BpmnElement[] = [];
    if (laneSet.list('lanes').length === 1) {
      extra = parentLane ? this.takeOverMembers(lane, parentLane, [...parentLane.list('flowNodeRef')], command, changes) : this.takeOverMembers(lane, process, document.scopes.flowNodes(process), command, changes);
    }
    if (!document.flows.participantOf(process)) {
      changes.warn({
        code: 'W_LANES_WITHOUT_POOL',
        message: `Process ${process.id} has lanes but no participant; lanes are only drawn inside a pool`,
        element: id,
        hint: `Add a pool with \`add participant "<name>"\` (it wraps the existing process).`,
      });
    }
    for (const memberId of command.members ?? []) {
      this.assign(this.edit.require(memberId, 'bpmn:FlowNode', 'flow node'), lane, changes);
    }
    if (extra.length) {
      const extraIds = extra.map((element) => element.id);
      const owner = parentLane ?? process;
      const reason = parentLane ? 'because a lane with child lanes has no direct members' : 'because the first lane covers the whole pool';
      changes.warn({
        code: 'W_OPTION_IGNORED',
        message: `--members ${command.members!.join(',')}: ${id} also received the other ${extra.length} member(s) of ${owner.id} (${extraIds.join(', ')}), ${reason}`,
        element: id,
        related: extraIds,
        hint: `Move them into a sibling lane: \`bpmn add <file> lane "<name>" --in ${owner.id} --members ${extraIds.join(',')}\`.`,
      });
    }
    document.tree.invalidate();
    return lane;
  }

  private takeOverMembers(lane: BpmnElement, owner: BpmnElement, nodes: BpmnElement[], command: AddOperation, changes: ChangeSet): BpmnElement[] {
    if (!nodes.length) {
      return [];
    }
    for (const node of nodes) {
      if (owner.is('bpmn:Lane')) {
        owner.remove('flowNodeRef', node);
      }
      lane.add('flowNodeRef', node);
    }
    const ownerLabel = owner.is('bpmn:Lane') ? `${owner.id} into its first child lane` : `${owner.id} into its first lane`;
    changes.note(`moved ${nodes.length} member(s) of ${ownerLabel} ${lane.id}`);
    if (!command.members?.length) {
      return [];
    }
    return nodes.filter((node) => !command.members!.includes(node.id));
  }

  assign(node: BpmnElement, lane: BpmnElement | undefined, changes: ChangeSet): void {
    const document = this.edit.document;
    const process = this.assertLaneMember(node);
    if (lane) {
      if (!lane.is('bpmn:Lane')) {
        throw BpmnError.model('E_WRONG_KIND', `${lane.id} is a ${Kinds.label(lane)}, expected a lane`, { element: lane.id });
      }
      if (document.scopes.processOf(lane) !== process) {
        throw BpmnError.model('E_INVALID_LANE_MEMBERSHIP', `Lane ${lane.id} belongs to another process than ${node.id} (${process.id})`, {
          element: node.id,
          related: [lane.id],
          hint: 'Nodes can only join lanes of their own process.',
        });
      }
      const childSet = lane.get<BpmnElement | undefined>('childLaneSet');
      const children = childSet ? childSet.list('lanes') : [];
      if (children.length) {
        throw BpmnError.model('E_INVALID_LANE_MEMBERSHIP', `Lane ${lane.id} has child lanes; assign ${node.id} to one of them`, {
          element: node.id,
          related: [lane.id],
          candidates: children.map((element) => element.id),
        });
      }
    }
    const current = document.scopes.lanesOf(node);
    const unchanged = lane ? current.length === 1 && current[0] === lane : current.length === 0;
    if (!unchanged) {
      for (const other of current) {
        other.remove('flowNodeRef', node);
      }
      if (lane) {
        lane.add('flowNodeRef', node);
      }
      const name = node.name;
      changes.change({ id: node.id, kind: Kinds.label(node), ...(name ? { name } : {}), detail: lane ? `lane ${lane.id}` : 'removed from lanes' });
    }
    if (node.is('bpmn:Activity')) {
      for (const boundary of document.scopes.boundaryEventsOf(node)) {
        this.assign(boundary, lane, changes);
      }
    }
    document.tree.invalidate();
  }

  private ensureLaneSet(process: BpmnElement, changes: ChangeSet): BpmnElement {
    const sets = process.list('laneSets');
    if (sets[0]) {
      return sets[0];
    }
    const laneSet = this.edit.document.tree.create('bpmn:LaneSet', { id: this.edit.allocator.allocate(IdRequests.typeRequest('bpmn:LaneSet', { context: new ElementLabels(process).label() })).id });
    process.add('laneSets', laneSet);
    changes.note(`created laneSet ${laneSet.id} in ${process.id}`);
    return laneSet;
  }

  private ensureChildLaneSet(lane: BpmnElement, changes: ChangeSet): BpmnElement {
    const existing = lane.get<BpmnElement | undefined>('childLaneSet');
    if (existing) {
      return existing;
    }
    const laneSet = this.edit.document.tree.create('bpmn:LaneSet', { id: this.edit.allocator.allocate(IdRequests.typeRequest('bpmn:LaneSet', { context: new ElementLabels(lane).label() })).id });
    lane.set('childLaneSet', laneSet);
    laneSet.parent = lane;
    changes.note(`created nested laneSet ${laneSet.id} in lane ${lane.id}`);
    return laneSet;
  }

  private resolveLaneContainer(command: AddOperation): { process: BpmnElement; parentLane?: BpmnElement } {
    const document = this.edit.document;
    if (!command.in) {
      return { process: document.scopes.defaultScope() };
    }
    const container = this.edit.require(command.in, ['bpmn:Process', 'bpmn:Participant', 'bpmn:Lane', 'bpmn:SubProcess'], 'lane container');
    if (container.is('bpmn:SubProcess')) {
      throw BpmnError.model('E_INVALID_SCOPE', `LaneMembership can only be created at process level, not inside sub-process ${command.in}`, {
        element: command.in,
        hint: 'Use --in <processId|participantId|laneId>.',
      });
    }
    if (container.is('bpmn:Lane')) {
      const process = document.scopes.processOf(container);
      if (!process) {
        throw BpmnError.model('E_INVALID_SCOPE', `Lane ${command.in} is not inside a process`, { element: command.in });
      }
      return { process, parentLane: container };
    }
    return { process: this.edit.requireScope(command.in) };
  }

  private assertLaneMember(node: BpmnElement): BpmnElement {
    if (!node.is('bpmn:FlowNode')) {
      throw BpmnError.model('E_INVALID_LANE_MEMBERSHIP', `${node.id} is a ${Kinds.label(node)}; only flow nodes can be lane members`, { element: node.id });
    }
    const scope = this.edit.document.scopes.scopeOf(node);
    if (!scope || !scope.is('bpmn:Process')) {
      throw BpmnError.model('E_INVALID_LANE_MEMBERSHIP', `${node.id} is inside sub-process ${scope ? scope.id : '?'}; nodes inside sub-processes cannot be lane members`, {
        element: node.id,
        hint: 'Only nodes directly in the process can be assigned to lanes; the sub-process itself can.',
      });
    }
    return scope;
  }
}
