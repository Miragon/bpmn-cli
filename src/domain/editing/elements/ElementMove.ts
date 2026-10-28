import type { EditSession } from '../../document/EditSession.js';
import { modelError, usageError } from '../../document/utils/errors.js';
import { kindLabel } from '../../document/Kinds.js';
import { addTo, is, removeFrom, walk, type El } from '../../document/utils/moddle.js';
import { ChangeSet } from '../../document/ChangeSet.js';
import { Lanes } from './Lanes.js';
import { laneOf } from '../../document/utils/lanes.js';
import { FlowBridge } from '../connections/FlowBridge.js';
import { insertAfterInScope } from '../utils/declaration-order.js';
import { LaneInheritance } from './LaneInheritance.js';
import { IdRename } from '../ids/IdRename.js';
import { idOf } from '../../document/utils/elements.js';
import { FlowOptions } from '../connections/FlowOptions.js';
import type { MoveElements } from '../../commands/types.js';
import { NodePlacement, type PlacementOptions } from './NodePlacement.js';
import { EventGatewayRule } from '../events/EventGatewayRule.js';
import { SequenceFlows } from '../connections/SequenceFlows.js';

/**
 * `move`: relocates nodes via --after/--before/--flow (chained in order), --in, --on or --lane.
 * The old place is bridged. A move that leaves every node where it is changes nothing.
 */
export class ElementMove {
  constructor(private readonly edit: EditSession) {}

  move(command: MoveElements): ChangeSet {
    const changes = new ChangeSet();
    if (!command.ids?.length) throw usageError('move needs at least one node id');
    const mode = NodePlacement.modeOf(command);
    const hasLane = command.lane !== undefined;
    if (mode === 'none' && !hasLane) {
      throw usageError('move needs a placement (--after, --before, --flow, --in, --on) and/or --lane <laneId>');
    }
    const nodes = command.ids.map((id) => this.edit.require(id, 'bpmn:FlowNode'));
    const placement = ElementMove.placementOf(command);
    if (mode === 'in') {
      this.moveInto(nodes, placement, changes);
    } else if (mode === 'on') {
      for (const node of nodes) this.moveOnto(node, placement, changes);
    } else if (mode !== 'none') {
      this.assertFirstPlacement(nodes[0]!, placement);
      this.assertChainAnchor(nodes, placement);
      if (this.inPlace(nodes, placement)) {
        changes.note(`${nodes.map(idOf).join(', ')} ${nodes.length > 1 ? 'are' : 'is'} already ${ElementMove.describePlacement(placement)}${nodes.length > 1 ? ', in this order' : ''}`);
        this.optionsOnInFlow(this.edit.doc.incoming(nodes[0]!)[0], placement, changes);
      } else {
        nodes.forEach((node, index) => {
          const prev = nodes[index - 1];
          this.moveNode(node, prev ? { after: idOf(prev) } : placement, changes, hasLane);
        });
      }
    }
    if (hasLane) {
      const lane = command.lane ? this.edit.require(command.lane, 'bpmn:Lane', 'lane') : undefined;
      for (const node of nodes) new Lanes(this.edit).assign(node, lane, changes);
    }
    this.edit.doc.invalidate();
    return changes;
  }

  private static placementOf(command: MoveElements): PlacementOptions {
    const placement: PlacementOptions = {};
    if (command.after) placement.after = command.after;
    if (command.before) placement.before = command.before;
    if (command.flow) placement.flow = command.flow;
    if (command.in) placement.in = command.in;
    if (command.on) placement.on = command.on;
    if (command.flowName !== undefined) placement.flowName = command.flowName;
    if (command.flowId) placement.flowId = command.flowId;
    if (command.condition !== undefined) placement.condition = command.condition;
    if (command.language) placement.language = command.language;
    if (command.default) placement.default = true;
    return placement;
  }

  private static describePlacement(placement: PlacementOptions): string {
    if (placement.after && placement.before) return `between ${placement.after} and ${placement.before}`;
    if (placement.after) return `after ${placement.after}`;
    if (placement.before) return `before ${placement.before}`;
    if (placement.flow) return `into flow ${placement.flow}`;
    if (placement.on) return `onto ${placement.on}`;
    return `into ${placement.in ?? 'the process'}`;
  }

  private anchorsOf(placement: PlacementOptions): El[] {
    const out: El[] = [];
    if (placement.after) out.push(this.edit.require(placement.after, 'bpmn:FlowNode'));
    if (placement.before) out.push(this.edit.require(placement.before, 'bpmn:FlowNode'));
    if (placement.flow) {
      const flow = this.edit.require(placement.flow, 'bpmn:SequenceFlow', 'sequence flow');
      out.push(flow.get<El>('sourceRef'), flow.get<El>('targetRef'));
    }
    if (placement.on) out.push(this.edit.require(placement.on, 'bpmn:Activity', 'activity'));
    if (placement.in) out.push(this.edit.requireScope(placement.in));
    return out;
  }

  private static isBoundaryOf(node: El, anchor: El): boolean {
    return is(anchor, 'bpmn:BoundaryEvent') && anchor.get<El | undefined>('attachedToRef') === node;
  }

  private static isInside(node: El, anchor: El): boolean {
    return anchor === node || ElementMove.isBoundaryOf(node, anchor) || [...walk(node)].includes(anchor);
  }

  private static assertNotInside(node: El, anchor: El): void {
    if (ElementMove.isInside(node, anchor)) {
      const what = ElementMove.isBoundaryOf(node, anchor) ? 'that is one of its boundary events, which move with it' : 'that is the node itself or one of its children';
      throw modelError('E_INVALID_PLACEMENT', `${idOf(node)} cannot be moved relative to ${idOf(anchor)}: ${what}`, {
        element: idOf(node),
        related: [idOf(anchor)],
        hint: 'Pick an anchor outside the moved node.',
      });
    }
  }

  private assertFirstPlacement(node: El, placement: PlacementOptions): void {
    ElementMove.assertNotBoundary(node);
    for (const anchor of this.anchorsOf(placement)) ElementMove.assertNotInside(node, anchor);
  }

  private static assertNotBoundary(node: El): void {
    if (is(node, 'bpmn:BoundaryEvent')) {
      throw modelError('E_INVALID_PLACEMENT', `Boundary event ${idOf(node)} is moved with --on <activityId>`, { element: idOf(node) });
    }
  }

  /**
   * The chain must not start after a later node of itself. A --before anchor that is a later
   * node is fine (`move A Join --before Join` ends A -> Join).
   */
  private assertChainAnchor(nodes: El[], placementOptions: PlacementOptions): void {
    const mode = NodePlacement.modeOf(placementOptions);
    const later = nodes.slice(1);
    const flow = mode === 'flow' ? this.edit.require(placementOptions.flow!, 'bpmn:SequenceFlow', 'sequence flow') : undefined;
    const after = mode === 'after' || mode === 'between' ? this.edit.require(placementOptions.after!, 'bpmn:FlowNode') : flow?.get<El>('sourceRef');
    const before = mode === 'before' || mode === 'between' ? this.edit.require(placementOptions.before!, 'bpmn:FlowNode') : undefined;
    let anchor = after;
    let holder = after && later.find((laterNode) => ElementMove.isInside(laterNode, after));
    if (!holder && before) {
      anchor = before;
      holder = later.find((laterNode) => laterNode !== before && ElementMove.isInside(laterNode, before));
    }
    if (!anchor || !holder) return;
    const ids = nodes.map(idOf);
    const first = ids[0]!;
    const what = anchor === holder ? 'is one of the moved nodes' : `is ${ElementMove.isBoundaryOf(holder, anchor) ? 'a boundary event of' : 'inside'} ${idOf(holder)}, one of the moved nodes`;
    const placement = flow ? `--flow ${idOf(flow)}` : [...(placementOptions.after ? [`--after ${placementOptions.after}`] : []), ...(placementOptions.before ? [`--before ${placementOptions.before}`] : [])].join(' ');
    const itself = `The chain would be placed ${anchor === before ? 'inside' : 'after'} itself.`;
    let hint = `${itself} Pick an anchor outside the moved nodes, or move ${first} alone: \`bpmn move <file> ${first} ${placement}\`.`;
    if (this.inPlace(nodes.slice(0, 1), placementOptions)) {
      const reorder = mode === 'after' && this.edit.doc.incoming(anchor).length === 1;
      hint = `${itself} ${first} is already ${ElementMove.describePlacement(placementOptions)}. Pick an anchor outside the moved nodes${reorder ? `, or put ${first} before ${idOf(anchor)}: \`bpmn move <file> ${first} --before ${idOf(anchor)}\`` : ''}.`;
    }
    throw modelError('E_INVALID_PLACEMENT', `${flow ? `${idOf(flow)} cannot anchor the move of ${ids.join(', ')}: its source ${idOf(anchor)}` : `${idOf(anchor)} cannot anchor the move of ${ids.join(', ')}: it`} ${what}`, {
      element: flow ? idOf(flow) : idOf(anchor),
      related: ids,
      hint,
    });
  }

  /** A move in place: flow options apply to the flow into the first node; a flowId renames it. */
  private optionsOnInFlow(flow: El | undefined, placement: PlacementOptions, changes: ChangeSet): void {
    if (!flow) return;
    const old = idOf(flow);
    const renamed = placement.flowId !== undefined && placement.flowId !== old;
    if (renamed) new IdRename(this.edit).rename(flow, placement.flowId!);
    const options = new ChangeSet();
    new FlowOptions(placement).apply(this.edit, flow, options);
    if (!renamed && !options.changed.length) return;
    changes.change(ChangeSet.flowEntryOf(flow, `${ChangeSet.flowEntryOf(flow).detail}${renamed ? ` (renamed from ${old})` : ''}`));
  }

  /**
   * Whether the placement leaves every node where it is. After a gateway the chain would be a
   * new branch, before a join a prepend, so neither counts as in place.
   */
  private inPlace(nodes: El[], placement: PlacementOptions): boolean {
    if (nodes.some((node) => is(node, 'bpmn:BoundaryEvent')) || new Set(nodes).size !== nodes.length) return false;
    if (new FlowOptions(placement).flags.length && this.edit.doc.incoming(nodes[0]!).length !== 1) return false;
    const onlyIn = (node: El): El | undefined => {
      const flows = this.edit.doc.incoming(node);
      return flows.length === 1 ? flows[0]!.get<El>('sourceRef') : undefined;
    };
    const onlyOut = (node: El): El | undefined => {
      const flows = this.edit.doc.outgoing(node);
      return flows.length === 1 ? flows[0]!.get<El>('targetRef') : undefined;
    };
    for (let index = 1; index < nodes.length; index++) if (is(nodes[index - 1]!, 'bpmn:Gateway') || onlyIn(nodes[index]!) !== nodes[index - 1]) return false;
    const first = nodes[0]!;
    const last = nodes[nodes.length - 1]!;
    const mode = NodePlacement.modeOf(placement);
    if (mode === 'after') {
      const afterNode = this.edit.require(placement.after!, 'bpmn:FlowNode');
      return !is(afterNode, 'bpmn:Gateway') && onlyIn(first) === afterNode;
    }
    if (mode === 'before') {
      const beforeNode = this.edit.require(placement.before!, 'bpmn:FlowNode');
      return !(is(beforeNode, 'bpmn:Gateway') && this.edit.doc.incoming(beforeNode).length >= 2) && onlyOut(last) === beforeNode;
    }
    if (mode === 'between') return onlyIn(first) === this.edit.require(placement.after!, 'bpmn:FlowNode') && onlyOut(last) === this.edit.require(placement.before!, 'bpmn:FlowNode');
    return false;
  }

  private deepestLane(el: El): El | undefined {
    const lanes = this.edit.doc.lanesOf(el);
    return lanes[lanes.length - 1];
  }

  /** Lane membership is dropped when the process changes or the target is a sub-process. */
  private leaveScope(moved: El[], oldScope: El | undefined, targetScope: El, changes: ChangeSet): void {
    const processChanged = !oldScope || this.edit.doc.processOf(oldScope) !== this.edit.doc.processOf(targetScope);
    const dropLanes = oldScope !== targetScope && (processChanged || !is(targetScope, 'bpmn:Process'));
    for (const movedNode of moved) {
      if (dropLanes) {
        for (const lane of this.edit.doc.lanesOf(movedNode)) {
          removeFrom(lane, 'flowNodeRef', movedNode);
          changes.change(ChangeSet.entryOf(lane, `member ${idOf(movedNode)} removed`));
        }
      }
      if (oldScope) removeFrom(oldScope, 'flowElements', movedNode);
    }
  }

  /** Re-declares flows within `scope`; flows that would cross scopes are removed and reported. */
  private fixFlows(moved: El[], scope: El, changes: ChangeSet): void {
    const seen = new Set<El>();
    for (const movedNode of moved) {
      for (const flow of [...this.edit.doc.incoming(movedNode), ...this.edit.doc.outgoing(movedNode)]) {
        if (seen.has(flow)) continue;
        seen.add(flow);
        const src = flow.get<El>('sourceRef');
        const tgt = flow.get<El>('targetRef');
        if (this.edit.doc.scopeOf(src) === scope && this.edit.doc.scopeOf(tgt) === scope) {
          const declaredIn = flow.$parent as El | undefined;
          if (declaredIn !== scope) {
            if (declaredIn) removeFrom(declaredIn, 'flowElements', flow);
            insertAfterInScope(scope, src, flow);
          }
          continue;
        }
        new SequenceFlows(this.edit).remove(flow, changes);
        changes.remove(ChangeSet.flowEntryOf(flow));
        changes.warn({
          code: 'W_FLOW_DROPPED',
          message: `Sequence flow ${idOf(flow)} (${idOf(src)} -> ${idOf(tgt)}) was removed: it would cross scopes after the move`,
          element: idOf(flow),
          related: [idOf(src), idOf(tgt)],
          hint: 'Connect the node again inside its new scope with `bpmn connect <file> <source> <target>`.',
        });
      }
    }
  }

  private inheritLane(node: El, boundaries: El[], anchor: El | undefined, scope: El): void {
    if (!anchor || !is(scope, 'bpmn:Process') || this.edit.doc.lanesOf(node).length) return;
    const lane = this.deepestLane(anchor);
    if (!lane) return;
    this.joinLane(lane, node, boundaries);
  }

  private joinLane(lane: El, node: El, boundaries: El[]): void {
    addTo(lane, 'flowNodeRef', node);
    for (const boundary of boundaries) if (!this.edit.doc.lanesOf(boundary).length) addTo(lane, 'flowNodeRef', boundary);
  }

  /** A reused id would show up as both removed and created in the result. */
  private reserveIds(ids: string[]): void {
    for (const id of ids) if (id && !this.edit.doc.has(id)) this.edit.doc.ids.claim(id);
  }

  /**
   * Moves a node to its placement. The node's own and inherited lane are decided before the
   * placement, as a splice may rename the flow.
   */
  private moveNode(node: El, placement: PlacementOptions, changes: ChangeSet, explicitLane: boolean): void {
    ElementMove.assertNotBoundary(node);
    const anchors = this.anchorsOf(placement);
    for (const anchor of anchors) ElementMove.assertNotInside(node, anchor);
    const oldScope = this.edit.doc.scopeOf(node);
    const targetScope = new NodePlacement(this.edit, placement).scope();
    const boundaries = is(node, 'bpmn:Activity') ? this.edit.doc.boundaryEventsOf(node) : [];
    const incoming = this.edit.doc.incoming(node);
    const outgoing = this.edit.doc.outgoing(node);
    const flowIds = [...incoming, ...outgoing].map(idOf);
    new FlowBridge(this.edit, changes, 'move').single(node, true);
    this.reserveIds(flowIds);
    const laneBefore = laneOf(this.edit.doc, node);
    this.leaveScope([node, ...boundaries], oldScope, targetScope, changes);
    this.edit.doc.invalidate();
    const own = laneBefore && (laneBefore.get<El[] | undefined>('flowNodeRef') ?? []).includes(node) ? laneBefore : undefined;
    const inherited = !explicitLane && is(targetScope, 'bpmn:Process') ? LaneInheritance.of(this.edit.doc, placement) : LaneInheritance.NONE;
    new NodePlacement(this.edit, placement).place(node, changes);
    for (const flow of new Set([...this.edit.doc.incoming(node), ...this.edit.doc.outgoing(node)])) new EventGatewayRule(this.edit).warnFlow(flow, changes);
    if (boundaries.length) insertAfterInScope(targetScope, node, ...boundaries);
    this.fixFlows(boundaries, targetScope, changes);
    if (own) {
      const note = explicitLane ? undefined : inherited.crossNote(idOf(node), own);
      if (note) changes.note(note);
    } else if (inherited.lane) {
      this.joinLane(inherited.lane, node, boundaries);
      const warning = inherited.warning(idOf(node));
      if (warning) changes.warn(warning);
    }
    changes.change(ChangeSet.entryOf(node, `moved ${ElementMove.describePlacement(placement)}`));
    changes.relocated.push(idOf(node));
    this.edit.doc.invalidate();
  }

  private moveInto(nodes: El[], placement: PlacementOptions, changes: ChangeSet): void {
    const scope = new NodePlacement(this.edit, placement).scope();
    const relocating: El[] = [];
    for (const node of nodes) {
      if (is(node, 'bpmn:BoundaryEvent')) {
        throw modelError('E_INVALID_PLACEMENT', `Boundary event ${idOf(node)} is moved with --on <activityId>`, { element: idOf(node) });
      }
      ElementMove.assertNotInside(node, scope);
      if (this.edit.doc.scopeOf(node) === scope) {
        changes.note(`${idOf(node)} is already in ${idOf(scope)}`);
        continue;
      }
      relocating.push(node);
    }
    new FlowBridge(this.edit, changes, 'move').group(relocating);
    const moved: El[] = [];
    for (const node of relocating) {
      const oldScope = this.edit.doc.scopeOf(node);
      const boundaries = is(node, 'bpmn:Activity') ? this.edit.doc.boundaryEventsOf(node) : [];
      this.leaveScope([node, ...boundaries], oldScope, scope, changes);
      insertAfterInScope(scope, undefined, node, ...boundaries);
      moved.push(node, ...boundaries);
      changes.change(ChangeSet.entryOf(node, `moved into ${idOf(scope)}`));
      changes.relocated.push(idOf(node));
    }
    this.fixFlows(moved, scope, changes);
    this.edit.doc.invalidate();
  }

  private moveOnto(node: El, placement: PlacementOptions, changes: ChangeSet): void {
    if (!is(node, 'bpmn:BoundaryEvent')) {
      throw modelError('E_INVALID_PLACEMENT', `--on attaches boundary events only; ${kindLabel(node)} ${idOf(node)} is moved with --after/--before/--flow/--in`, {
        element: idOf(node),
      });
    }
    const host = this.edit.require(placement.on!, 'bpmn:Activity', 'activity');
    const oldHost = node.get<El | undefined>('attachedToRef');
    if (oldHost === host) {
      changes.note(`${idOf(node)} is already attached to ${idOf(host)}`);
      return;
    }
    const oldScope = this.edit.doc.scopeOf(node);
    const scope = this.edit.doc.scopeOf(host) ?? this.edit.doc.defaultScope();
    this.leaveScope([node], oldScope, scope, changes);
    new NodePlacement(this.edit, { on: placement.on! }).place(node, changes);
    this.fixFlows([node], scope, changes);
    this.inheritLane(node, [], host, scope);
    changes.change(ChangeSet.entryOf(node, `moved onto ${idOf(host)}${oldHost ? ` (was ${idOf(oldHost)})` : ''}`));
    this.edit.doc.invalidate();
  }
}
