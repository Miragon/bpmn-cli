import { type BpmnElement, BpmnError, ChangeEntries, ChangeSet, ElementWalk, Kinds } from '../model/index.js';
import type { MoveOperation } from '../operations/index.js';
import { LaneInheritance } from './containers/LaneInheritance.js';
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
      this.assertFirstPlacement(nodes[0]!, placement);
      this.assertChainAnchor(nodes, placement);
      if (this.inPlace(nodes, placement)) {
        changes.note(`${nodes.map((element) => element.id).join(', ')} ${nodes.length > 1 ? 'are' : 'is'} already ${ElementMove.describePlacement(placement)}${nodes.length > 1 ? ', in this order' : ''}`);
      } else {
        nodes.forEach((node, index) => {
          const prev = nodes[index - 1];
          this.moveNode(node, prev ? { after: prev.id } : placement, changes, hasLane);
        });
      }
    }
    if (hasLane) {
      const lane = command.lane ? this.edit.require(command.lane, 'bpmn:Lane', 'lane') : undefined;
      for (const node of nodes) {
        new LaneMembership(this.edit).assign(node, lane, changes);
      }
    }
    this.edit.document.tree.invalidate();
    return changes;
  }

  private static placementOf(command: MoveOperation): PlacementOptions {
    const placement: PlacementOptions = {};
    if (command.after) {
      placement.after = command.after;
    }
    if (command.before) {
      placement.before = command.before;
    }
    if (command.flow) {
      placement.flow = command.flow;
    }
    if (command.in) {
      placement.in = command.in;
    }
    if (command.on) {
      placement.on = command.on;
    }
    return placement;
  }

  private static describePlacement(placement: PlacementOptions): string {
    if (placement.after && placement.before) {
      return `between ${placement.after} and ${placement.before}`;
    }
    if (placement.after) {
      return `after ${placement.after}`;
    }
    if (placement.before) {
      return `before ${placement.before}`;
    }
    if (placement.flow) {
      return `into flow ${placement.flow}`;
    }
    if (placement.on) {
      return `onto ${placement.on}`;
    }
    return `into ${placement.in ?? 'the process'}`;
  }

  private anchorsOf(placement: PlacementOptions): BpmnElement[] {
    const out: BpmnElement[] = [];
    if (placement.after) {
      out.push(this.edit.require(placement.after, 'bpmn:FlowNode'));
    }
    if (placement.before) {
      out.push(this.edit.require(placement.before, 'bpmn:FlowNode'));
    }
    if (placement.flow) {
      const flow = this.edit.require(placement.flow, 'bpmn:SequenceFlow', 'sequence flow');
      out.push(flow.get<BpmnElement>('sourceRef'), flow.get<BpmnElement>('targetRef'));
    }
    if (placement.on) {
      out.push(this.edit.require(placement.on, 'bpmn:Activity', 'activity'));
    }
    if (placement.in) {
      out.push(this.edit.requireScope(placement.in));
    }
    return out;
  }

  private static isBoundaryOf(node: BpmnElement, anchor: BpmnElement): boolean {
    return anchor.is('bpmn:BoundaryEvent') && anchor.get<BpmnElement | undefined>('attachedToRef') === node;
  }

  private static isInside(node: BpmnElement, anchor: BpmnElement): boolean {
    return anchor === node || ElementMove.isBoundaryOf(node, anchor) || [...new ElementWalk(node).depthFirst()].includes(anchor);
  }

  private static assertNotInside(node: BpmnElement, anchor: BpmnElement): void {
    if (ElementMove.isInside(node, anchor)) {
      const what = ElementMove.isBoundaryOf(node, anchor) ? 'that is one of its boundary events, which move with it' : 'that is the node itself or one of its children';
      throw BpmnError.model('E_INVALID_PLACEMENT', `${node.id} cannot be moved relative to ${anchor.id}: ${what}`, {
        element: node.id,
        related: [anchor.id],
        hint: 'Pick an anchor outside the moved node.',
      });
    }
  }

  private assertFirstPlacement(node: BpmnElement, placement: PlacementOptions): void {
    ElementMove.assertNotBoundary(node);
    for (const anchor of this.anchorsOf(placement)) {
      ElementMove.assertNotInside(node, anchor);
    }
  }

  private static assertNotBoundary(node: BpmnElement): void {
    if (node.is('bpmn:BoundaryEvent')) {
      throw BpmnError.model('E_INVALID_PLACEMENT', `Boundary event ${node.id} is moved with --on <activityId>`, { element: node.id });
    }
  }

  private assertChainAnchor(nodes: BpmnElement[], placementOptions: PlacementOptions): void {
    const mode = NodePlacement.modeOf(placementOptions);
    const later = nodes.slice(1);
    const flow = mode === 'flow' ? this.edit.require(placementOptions.flow!, 'bpmn:SequenceFlow', 'sequence flow') : undefined;
    const after = mode === 'after' || mode === 'between' ? this.edit.require(placementOptions.after!, 'bpmn:FlowNode') : flow?.get<BpmnElement>('sourceRef');
    const before = mode === 'before' || mode === 'between' ? this.edit.require(placementOptions.before!, 'bpmn:FlowNode') : undefined;
    let anchor = after;
    let holder = after && later.find((laterNode) => ElementMove.isInside(laterNode, after));
    if (!holder && before) {
      anchor = before;
      holder = later.find((laterNode) => laterNode !== before && ElementMove.isInside(laterNode, before));
    }
    if (!anchor || !holder) {
      return;
    }
    const ids = nodes.map((element) => element.id);
    const first = ids[0]!;
    const what = anchor === holder ? 'is one of the moved nodes' : `is ${ElementMove.isBoundaryOf(holder, anchor) ? 'a boundary event of' : 'inside'} ${holder.id}, one of the moved nodes`;
    const placement = flow ? `--flow ${flow.id}` : [...(placementOptions.after ? [`--after ${placementOptions.after}`] : []), ...(placementOptions.before ? [`--before ${placementOptions.before}`] : [])].join(' ');
    const itself = `The chain would be placed ${anchor === before ? 'inside' : 'after'} itself.`;
    let hint = `${itself} Pick an anchor outside the moved nodes, or move ${first} alone: \`bpmn move <file> ${first} ${placement}\`.`;
    if (this.inPlace(nodes.slice(0, 1), placementOptions)) {
      const reorder = mode === 'after' && this.edit.document.flows.incoming(anchor).length === 1;
      hint = `${itself} ${first} is already ${ElementMove.describePlacement(placementOptions)}. Pick an anchor outside the moved nodes${reorder ? `, or put ${first} before ${anchor.id}: \`bpmn move <file> ${first} --before ${anchor.id}\`` : ''}.`;
    }
    throw BpmnError.model('E_INVALID_PLACEMENT', `${flow ? `${flow.id} cannot anchor the move of ${ids.join(', ')}: its source ${anchor.id}` : `${anchor.id} cannot anchor the move of ${ids.join(', ')}: it`} ${what}`, {
      element: flow ? flow.id : anchor.id,
      related: ids,
      hint,
    });
  }

  private inPlace(nodes: BpmnElement[], placement: PlacementOptions): boolean {
    if (nodes.some((node) => node.is('bpmn:BoundaryEvent')) || new Set(nodes).size !== nodes.length) {
      return false;
    }
    const onlyIn = (node: BpmnElement): BpmnElement | undefined => {
      const flows = this.edit.document.flows.incoming(node);
      return flows.length === 1 ? flows[0]!.get<BpmnElement>('sourceRef') : undefined;
    };
    const onlyOut = (node: BpmnElement): BpmnElement | undefined => {
      const flows = this.edit.document.flows.outgoing(node);
      return flows.length === 1 ? flows[0]!.get<BpmnElement>('targetRef') : undefined;
    };
    for (let index = 1; index < nodes.length; index++) {
      if ((nodes[index - 1]!).is('bpmn:Gateway') || onlyIn(nodes[index]!) !== nodes[index - 1]) {
        return false;
      }
    }
    const first = nodes[0]!;
    const last = nodes[nodes.length - 1]!;
    const mode = NodePlacement.modeOf(placement);
    if (mode === 'after') {
      const afterNode = this.edit.require(placement.after!, 'bpmn:FlowNode');
      return !afterNode.is('bpmn:Gateway') && onlyIn(first) === afterNode;
    }
    if (mode === 'before') {
      const beforeNode = this.edit.require(placement.before!, 'bpmn:FlowNode');
      return !(beforeNode.is('bpmn:Gateway') && this.edit.document.flows.incoming(beforeNode).length >= 2) && onlyOut(last) === beforeNode;
    }
    if (mode === 'between') {
      return onlyIn(first) === this.edit.require(placement.after!, 'bpmn:FlowNode') && onlyOut(last) === this.edit.require(placement.before!, 'bpmn:FlowNode');
    }
    return false;
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
        const src = flow.get<BpmnElement>('sourceRef');
        const tgt = flow.get<BpmnElement>('targetRef');
        if (this.edit.document.scopes.scopeOf(src) === scope && this.edit.document.scopes.scopeOf(tgt) === scope) {
          const declaredIn = flow.parent;
          if (declaredIn !== scope) {
            if (declaredIn) {
              declaredIn.remove('flowElements', flow);
            }
            DeclarationOrder.insertAfter(scope, src, flow);
          }
          continue;
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
    }
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
    ElementMove.assertNotBoundary(node);
    const anchors = this.anchorsOf(placement);
    for (const anchor of anchors) {
      ElementMove.assertNotInside(node, anchor);
    }
    const oldScope = this.edit.document.scopes.scopeOf(node);
    const targetScope = new NodePlacement(this.edit, placement).scope();
    const boundaries = node.is('bpmn:Activity') ? this.edit.document.scopes.boundaryEventsOf(node) : [];
    const incoming = this.edit.document.flows.incoming(node);
    const outgoing = this.edit.document.flows.outgoing(node);
    const flowIds = [...incoming, ...outgoing].map((element) => element.id);
    new FlowBridge(this.edit, changes, 'move').single(node, true);
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
      DeclarationOrder.insertAfter(targetScope, node, ...boundaries);
    }
    this.fixFlows(boundaries, targetScope, changes);
    if (own) {
      const note = explicitLane ? undefined : inherited.crossNote(node.id, own);
      if (note) {
        changes.note(note);
      }
    } else if (inherited.lane) {
      this.joinLane(inherited.lane, node, boundaries);
      const warning = inherited.warning(node.id);
      if (warning) {
        changes.warn(warning);
      }
    }
    changes.change(ChangeEntries.of(node, `moved ${ElementMove.describePlacement(placement)}`));
    changes.relocated.push(node.id);
    this.edit.document.tree.invalidate();
  }

  private moveInto(nodes: BpmnElement[], placement: PlacementOptions, changes: ChangeSet): void {
    const scope = new NodePlacement(this.edit, placement).scope();
    const relocating: BpmnElement[] = [];
    for (const node of nodes) {
      if (node.is('bpmn:BoundaryEvent')) {
        throw BpmnError.model('E_INVALID_PLACEMENT', `Boundary event ${node.id} is moved with --on <activityId>`, { element: node.id });
      }
      ElementMove.assertNotInside(node, scope);
      if (this.edit.document.scopes.scopeOf(node) === scope) {
        changes.note(`${node.id} is already in ${scope.id}`);
        continue;
      }
      relocating.push(node);
    }
    new FlowBridge(this.edit, changes, 'move').group(relocating);
    const moved: BpmnElement[] = [];
    for (const node of relocating) {
      const oldScope = this.edit.document.scopes.scopeOf(node);
      const boundaries = node.is('bpmn:Activity') ? this.edit.document.scopes.boundaryEventsOf(node) : [];
      this.leaveScope([node, ...boundaries], oldScope, scope, changes);
      DeclarationOrder.insertAfter(scope, undefined, node, ...boundaries);
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
