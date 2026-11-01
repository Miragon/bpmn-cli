import { type BpmnElement, BpmnError, ChangeEntries, ChangeSet, Kinds, FlowEnds } from '../model/index.js';
import type { MoveOperation } from '../operations/index.js';
import { LaneInheritance } from './containers/LaneInheritance.js';
import { MoveAnchors } from './containers/MoveAnchors.js';
import { NodePlacement, type PlacementOptions } from './containers/NodePlacement.js';
import { EventGatewayRule } from './events/EventGatewayRule.js';
import { DeclarationOrder } from './flows/DeclarationOrder.js';
import { FlowBridge } from './flows/FlowBridge.js';
import { SequenceFlows } from './flows/SequenceFlows.js';
import { LaneMembership } from './LaneMembership.js';
import type { EditSession } from './session/EditSession.js';

export class ElementMove {
  constructor(private readonly edit: EditSession) {}

  move(command: MoveOperation): ChangeSet {
    const changes = new ChangeSet();
    const mode = NodePlacement.modeOf(command);
    const hasLane = command.lane !== undefined;
    const nodes = command.ids.map((id) => this.edit.require(id, 'bpmn:FlowNode'));
    const placement = ElementMove.placementOf(command);
    if (mode === 'in') {
      this.moveInto(nodes, placement, changes);
    } else if (mode === 'on') {
      for (const node of nodes) {
        this.moveOnto(node, placement, changes);
      }
    } else if (mode !== 'none') {
      this.moveChain(nodes, placement, changes, hasLane);
    }
    if (hasLane) {
      this.assignLane(nodes, command.lane, changes);
    }
    this.edit.document.tree.invalidate();
    return changes;
  }

  private moveChain(nodes: BpmnElement[], placement: PlacementOptions, changes: ChangeSet, explicitLane: boolean): void {
    const anchors = new MoveAnchors(this.edit);
    anchors.assertFirstPlacement(nodes[0]!, placement);
    anchors.assertChainAnchor(nodes, placement);
    if (anchors.inPlace(nodes, placement)) {
      changes.note(`${nodes.map((element) => element.id).join(', ')} ${nodes.length > 1 ? 'are' : 'is'} already ${MoveAnchors.describePlacement(placement)}${nodes.length > 1 ? ', in this order' : ''}`);
      return;
    }
    nodes.forEach((node, index) => {
      const prev = nodes[index - 1];
      this.moveNode(node, prev ? { after: prev.id } : placement, changes, explicitLane);
    });
  }

  private assignLane(nodes: BpmnElement[], laneId: string | undefined, changes: ChangeSet): void {
    const lane = laneId ? this.edit.require(laneId, 'bpmn:Lane', 'lane') : undefined;
    for (const node of nodes) {
      new LaneMembership(this.edit).assign(node, lane, changes);
    }
  }

  private static placementOf({ after, before, flow, in: scope, on }: MoveOperation): PlacementOptions {
    return { after, before, flow, in: scope, on };
  }

  private deepestLane(el: BpmnElement): BpmnElement | undefined {
    const lanes = this.edit.document.scopes.lanesOf(el);
    return lanes[lanes.length - 1];
  }

  private leaveScope(moved: BpmnElement[], oldScope: BpmnElement | undefined, targetScope: BpmnElement, changes: ChangeSet): void {
    const processChanged = !oldScope || this.edit.document.scopes.processOf(oldScope) !== this.edit.document.scopes.processOf(targetScope);
    const dropLanes = oldScope !== targetScope && (processChanged || !targetScope.is('bpmn:Process'));
    for (const movedNode of moved) {
      if (dropLanes) {
        for (const lane of this.edit.document.scopes.lanesOf(movedNode)) {
          lane.remove('flowNodeRef', movedNode);
          changes.change(ChangeEntries.of(lane, `member ${movedNode.id} removed`));
        }
      }
      if (oldScope) {
        oldScope.remove('flowElements', movedNode);
      }
    }
  }

  private fixFlows(moved: BpmnElement[], scope: BpmnElement, changes: ChangeSet): void {
    const seen = new Set<BpmnElement>();
    for (const movedNode of moved) {
      for (const flow of [...this.edit.document.flows.incoming(movedNode), ...this.edit.document.flows.outgoing(movedNode)]) {
        if (seen.has(flow)) {
          continue;
        }
        seen.add(flow);
        this.fixFlow(flow, scope, changes);
      }
    }
  }

  private fixFlow(flow: BpmnElement, scope: BpmnElement, changes: ChangeSet): void {
    const src = new FlowEnds(flow).source;
    const tgt = new FlowEnds(flow).target;
    if (this.edit.document.scopes.scopeOf(src) === scope && this.edit.document.scopes.scopeOf(tgt) === scope) {
      ElementMove.redeclareFlow(flow, src, scope);
      return;
    }
    new SequenceFlows(this.edit).remove(flow, changes);
    changes.remove(ChangeEntries.ofFlow(flow));
    changes.warn({
      code: 'W_FLOW_DROPPED',
      message: `Sequence flow ${flow.id} (${src.id} -> ${tgt.id}) was removed: it would cross scopes after the move`,
      element: flow.id,
      related: [src.id, tgt.id],
      hint: 'Connect the node again inside its new scope with `bpmn connect <file> <source> <target>`.',
    });
  }

  private static redeclareFlow(flow: BpmnElement, source: BpmnElement, scope: BpmnElement): void {
    const declaredIn = flow.parent;
    if (declaredIn === scope) {
      return;
    }
    if (declaredIn) {
      declaredIn.remove('flowElements', flow);
    }
    new DeclarationOrder(scope).insertAfter(source, flow);
  }

  private inheritLane(node: BpmnElement, boundaries: BpmnElement[], anchor: BpmnElement | undefined, scope: BpmnElement): void {
    if (!anchor || !scope.is('bpmn:Process') || this.edit.document.scopes.lanesOf(node).length) {
      return;
    }
    const lane = this.deepestLane(anchor);
    if (!lane) {
      return;
    }
    this.joinLane(lane, node, boundaries);
  }

  private joinLane(lane: BpmnElement, node: BpmnElement, boundaries: BpmnElement[]): void {
    lane.add('flowNodeRef', node);
    for (const boundary of boundaries) {
      if (!this.edit.document.scopes.lanesOf(boundary).length) {
        lane.add('flowNodeRef', boundary);
      }
    }
  }

  private reserveIds(ids: string[]): void {
    for (const id of ids) {
      if (id && !this.edit.document.tree.has(id)) {
        this.edit.document.ids.registry.claim(id);
      }
    }
  }

  private moveNode(node: BpmnElement, placement: PlacementOptions, changes: ChangeSet, explicitLane: boolean): void {
    new MoveAnchors(this.edit).assertFirstPlacement(node, placement);
    const oldScope = this.edit.document.scopes.scopeOf(node);
    const targetScope = new NodePlacement(this.edit, placement).scope();
    const boundaries = node.is('bpmn:Activity') ? this.edit.document.scopes.boundaryEventsOf(node) : [];
    const incoming = this.edit.document.flows.incoming(node);
    const outgoing = this.edit.document.flows.outgoing(node);
    const flowIds = [...incoming, ...outgoing].map((element) => element.id);
    new FlowBridge(this.edit, changes, 'move').bridgeNode(node, true);
    this.reserveIds(flowIds);
    const laneBefore = this.edit.document.scopes.laneOf(node);
    this.leaveScope([node, ...boundaries], oldScope, targetScope, changes);
    this.edit.document.tree.invalidate();
    const own = laneBefore && (laneBefore.get<BpmnElement[] | undefined>('flowNodeRef') ?? []).includes(node) ? laneBefore : undefined;
    const inherited = !explicitLane && targetScope.is('bpmn:Process') ? LaneInheritance.of(this.edit.document, placement) : LaneInheritance.NONE;
    new NodePlacement(this.edit, placement).place(node, changes);
    for (const flow of new Set([...this.edit.document.flows.incoming(node), ...this.edit.document.flows.outgoing(node)])) {
      new EventGatewayRule(this.edit).warnFlow(flow, changes);
    }
    if (boundaries.length) {
      new DeclarationOrder(targetScope).insertAfter(node, ...boundaries);
    }
    this.fixFlows(boundaries, targetScope, changes);
    if (own) {
      ElementMove.noteCrossedLane(node, own, inherited, explicitLane, changes);
    } else if (inherited.lane) {
      this.inheritLaneOf(inherited, node, boundaries, changes);
    }
    changes.change(ChangeEntries.of(node, `moved ${MoveAnchors.describePlacement(placement)}`));
    changes.relocated.push(node.id);
    this.edit.document.tree.invalidate();
  }

  private static noteCrossedLane(node: BpmnElement, own: BpmnElement, inherited: LaneInheritance, explicitLane: boolean, changes: ChangeSet): void {
    const note = explicitLane ? undefined : inherited.crossNote(node.id, own);
    if (note) {
      changes.note(note);
    }
  }

  private inheritLaneOf(inherited: LaneInheritance, node: BpmnElement, boundaries: BpmnElement[], changes: ChangeSet): void {
    this.joinLane(inherited.lane!, node, boundaries);
    const warning = inherited.warning(node.id);
    if (warning) {
      changes.warn(warning);
    }
  }

  private moveInto(nodes: BpmnElement[], placement: PlacementOptions, changes: ChangeSet): void {
    const scope = new NodePlacement(this.edit, placement).scope();
    const relocating: BpmnElement[] = [];
    for (const node of nodes) {
      MoveAnchors.assertNotBoundary(node);
      MoveAnchors.assertNotInside(node, scope);
      if (this.edit.document.scopes.scopeOf(node) === scope) {
        changes.note(`${node.id} is already in ${scope.id}`);
        continue;
      }
      relocating.push(node);
    }
    new FlowBridge(this.edit, changes, 'move').bridgeGroup(relocating);
    const moved: BpmnElement[] = [];
    for (const node of relocating) {
      const oldScope = this.edit.document.scopes.scopeOf(node);
      const boundaries = node.is('bpmn:Activity') ? this.edit.document.scopes.boundaryEventsOf(node) : [];
      this.leaveScope([node, ...boundaries], oldScope, scope, changes);
      new DeclarationOrder(scope).insertAfter(undefined, node, ...boundaries);
      moved.push(node, ...boundaries);
      changes.change(ChangeEntries.of(node, `moved into ${scope.id}`));
      changes.relocated.push(node.id);
    }
    this.fixFlows(moved, scope, changes);
    this.edit.document.tree.invalidate();
  }

  private moveOnto(node: BpmnElement, placement: PlacementOptions, changes: ChangeSet): void {
    if (!node.is('bpmn:BoundaryEvent')) {
      throw BpmnError.model('E_INVALID_PLACEMENT', `--on attaches boundary events only; ${Kinds.label(node)} ${node.id} is moved with --after/--before/--flow/--in`, {
        element: node.id,
      });
    }
    const host = this.edit.require(placement.on!, 'bpmn:Activity', 'activity');
    const oldHost = node.get<BpmnElement | undefined>('attachedToRef');
    if (oldHost === host) {
      changes.note(`${node.id} is already attached to ${host.id}`);
      return;
    }
    const oldScope = this.edit.document.scopes.scopeOf(node);
    const scope = this.edit.document.scopes.scopeOf(host) ?? this.edit.document.scopes.defaultScope();
    this.leaveScope([node], oldScope, scope, changes);
    new NodePlacement(this.edit, { on: placement.on! }).place(node, changes);
    this.fixFlows([node], scope, changes);
    this.inheritLane(node, [], host, scope);
    changes.change(ChangeEntries.of(node, `moved onto ${host.id}${oldHost ? ` (was ${oldHost.id})` : ''}`));
    this.edit.document.tree.invalidate();
  }
}
