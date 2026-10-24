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
 *  - with flow ids kept (EditContext.keepsFlowId, `--keep-flow-ids`) a moved node's one
 *    out-flow, which the detach takes out, is put back as the first flow the
 *    placement creates out of that node (the flow node -> successor of a
 *    splice, node -> anchor of a prepend, or node -> next node when the next
 *    one of the chain is appended to it, as always to a gateway: a gateway with
 *    a next node keeps it for that append), so it keeps its id, documentation
 *    and extensions and is reported as changed (W_FLOW_ID_STALE when its id
 *    named the old ends). Its name, condition and annotations stay with the
 *    bridge at the old place (once the chain is placed its last change says
 *    which, by the bridge's id then: `(was -> C; its name stays with the
 *    bridge Flow_AToB)`, reportBridgesKept), and it is no longer a default
 *    flow; a node that is not bridged, or whose bridge a later node of the
 *    chain removed, drops name and condition (W_LABEL_DROPPED /
 *    W_CONDITION_DROPPED), unless the flow ends between its old ends once the
 *    chain is placed (also when a later node of the chain takes it back
 *    there): then it gets them back, and (not bridged) its default marker,
 *    where the placement gave none; a default the placement gave the node
 *    wins (the change says the flow is no longer the default flow), and a
 *    flow the placement made the default flow gets no condition
 *    (W_CONDITION_DROPPED). A flowId for the
 *    flow a prepend creates (node -> anchor) makes a new flow instead. The
 *    chain runs through these flows, so a flow between moved nodes
 *    that matches it (a -> b of `move a b`) ends where it was, unless a has
 *    several out-flows; when the detach of b takes it out (b is not bridged: an
 *    end event, a join), the append of b after a puts it back with its name,
 *    condition and default marker. The flows nothing puts back stay removed:
 *    the out-flow of the last node appended after a gateway or a node without
 *    successor, the other flows of a node that is not bridged (several in- or
 *    out-flows, or none in or none out), and with --in the group's out-flow.
 *  - a placement that leaves every node where it is (inPlace: `move B
 *    --after A` with A -> B, `move B C --after A` with A -> B -> C, also
 *    --before and --after + --before) changes nothing, in both modes: a note
 *    `<ids> is already after A`, no write; flow options still go to the flow
 *    into the first node, and a flowId renames it (like `set id=`). Without
 *    that check the detach and the placement would put the node back with the
 *    out-flow's label on the in-flow and (by default) new flow ids. A move
 *    with --after <gateway> alone (an append: a new branch) or --before
 *    <join> alone (a prepend) is no such move.
 *
 * Conventions:
 *  - several ids with --after/--before/--flow are chained in the given order
 *    (X -> a -> b -> ...); with --in they are appended together and flows
 *    between them survive (re-declared in the new scope). The node the chain
 *    starts after (the --after anchor, the source of the --flow) must not be
 *    one of the moved nodes, inside one or a boundary event of one (it moves
 *    with its host): E_INVALID_PLACEMENT, before anything changes (the chain
 *    would be placed after itself). A --before anchor or the --flow's target
 *    may be a later node (`move A Join --before Join` ends A -> Join), not
 *    inside one.
 *  - lane membership is dropped when the node leaves its process or enters
 *    a sub-process; a node in a lane keeps it when it moves within its
 *    process (a note when the flow it went into runs between two other
 *    lanes). A node without a lane at its new place in a process (it came
 *    from a sub-process or another pool, or had none) inherits one with
 *    add's rule (LaneInheritance: the anchor's; in a flow between two
 *    lanes the lane of the row the layout draws it on, W_LANE_INHERITED),
 *    unless op.lane names one. --on re-attaches a boundary event (it takes
 *    its host's lane).
 */
import type { Doc } from '../model/Doc.js';
import { modelError, usageError } from '../shared/utils/errors.js';
import { type Warning } from '../shared/CliError.js';
import { kindLabel } from '../model/kinds.js';
import { addTo, is, removeFrom, walk, type El } from '../model/utils/moddle.js';
import { ChangeSet } from '../model/ChangeSet.js';
import { assignLane, laneOf } from './containers.js';
import { Bridge, type BridgedFlow } from './Bridge.js';
import { insertAfterInScope } from './utils/declaration-order.js';
import type { PlacementOptions } from './NodePlacement.js';
import { LaneInheritance } from './LaneInheritance.js';
import { IdRenamer } from './IdRenamer.js';
import { idOf } from './utils/elements.js';
import { FlowOptions } from './FlowOptions.js';
import type { MoveOp } from './types.js';
import { NodePlacement } from './NodePlacement.js';
import { EventGatewayRule } from './EventGatewayRule.js';
import { SequenceFlows } from './SequenceFlows.js';

/**
 * A flow the detach took out (flow ids kept), filed under the moved node it
 * leaves, and the target it had. `label`: the name, condition and default
 * marker no bridge took (the node was not bridged; for the flow from the node
 * moved before, the ones it has), given back when the flow is put back to
 * `target`, else dropped with W_LABEL_DROPPED / W_CONDITION_DROPPED.
 */
interface SpareFlow {
  flow: El;
  target: El;
  label?: FlowLabel;
}

interface FlowLabel {
  name: string | undefined;
  condition: El | undefined;
  isDefault: boolean;
}

/**
 * A label a placement dropped (a spare flow put back to another node), with
 * the warnings that said so: a later node of the chain may take the flow
 * back between its old ends (`move a b`, a not bridged: a's splice puts
 * a -> b back elsewhere, b's splice after a ends it at b again).
 */
interface DroppedLabel {
  node: El;
  flow: El;
  target: El;
  label: FlowLabel;
  warnings: Warning[];
}

/** A bridge a detach of the chain made: the moved node, its successor then (the out-flow's old target), what the bridge took. */
interface BridgeMade {
  node: El;
  target: El;
  bridge: BridgedFlow;
}

/** What a flow had when the move started: its name, condition and the associations of its annotations. */
interface LabelBefore {
  name: string | undefined;
  condition: El | undefined;
  associations: El[];
}

export class NodeMover {
  constructor(private readonly doc: Doc) {}

  /** Moves the nodes of `op.ids` (see module contract). */
  move(op: MoveOp): ChangeSet {
    const cs = new ChangeSet();
    if (!op.ids?.length) throw usageError('move needs at least one node id');
    const mode = NodePlacement.modeOf(op);
    const hasLane = op.lane !== undefined;
    if (mode === 'none' && !hasLane) {
      throw usageError('move needs a placement (--after, --before, --flow, --in, --on) and/or --lane <laneId>');
    }
    const nodes = op.ids.map((id) => this.doc.require(id, 'bpmn:FlowNode'));
    const placement = NodeMover.placementOf(op);
    if (mode === 'in') {
      this.moveInto(nodes, placement, cs);
    } else if (mode === 'on') {
      for (const node of nodes) this.moveOnto(node, placement, cs);
    } else if (mode !== 'none') {
      this.assertFirstPlacement(nodes[0]!, placement);
      this.assertChainAnchor(nodes, placement);
      if (this.inPlace(nodes, placement)) {
        cs.note(`${nodes.map(idOf).join(', ')} ${nodes.length > 1 ? 'are' : 'is'} already ${NodeMover.describePlacement(placement)}${nodes.length > 1 ? ', in this order' : ''}`);
        this.optionsOnInFlow(this.doc.incoming(nodes[0]!)[0], placement, cs);
      } else {
        // with flow ids kept: the flows the detach took out, by the moved node they leave, until a placement puts them back
        const spare = new Map<El, SpareFlow>();
        const dropped: DroppedLabel[] = [];
        // every bridge the detaches made, in order, and (flow ids kept) what the moved nodes' out-flows had before
        const bridges: BridgeMade[] = [];
        const before = this.doc.edit.followFlowEnds ? undefined : this.labelsBefore(nodes);
        nodes.forEach((node, i) => {
          const prev = nodes[i - 1];
          dropped.push(...this.moveNode(node, prev ? { after: idOf(prev) } : placement, cs, hasLane, spare, { prev, next: nodes[i + 1], bridges }));
        });
        this.giveBackLate(dropped, cs);
        if (before) this.reportBridgesKept(bridges, before, cs);
      }
    }
    if (hasLane) {
      const lane = op.lane ? this.doc.require(op.lane, 'bpmn:Lane', 'lane') : undefined;
      for (const node of nodes) assignLane(this.doc, node, lane, cs);
    }
    this.doc.invalidate();
    return cs;
  }

  private static placementOf(op: MoveOp): PlacementOptions {
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

  private static describePlacement(p: PlacementOptions): string {
    if (p.after && p.before) return `between ${p.after} and ${p.before}`;
    if (p.after) return `after ${p.after}`;
    if (p.before) return `before ${p.before}`;
    if (p.flow) return `into flow ${p.flow}`;
    if (p.on) return `onto ${p.on}`;
    return `into ${p.in ?? 'the process'}`;
  }

  /** Elements a placement refers to (for the "cannot move into itself" check and lane inheritance). */
  private anchorsOf(p: PlacementOptions): El[] {
    const out: El[] = [];
    if (p.after) out.push(this.doc.require(p.after, 'bpmn:FlowNode'));
    if (p.before) out.push(this.doc.require(p.before, 'bpmn:FlowNode'));
    if (p.flow) {
      const flow = this.doc.require(p.flow, 'bpmn:SequenceFlow', 'sequence flow');
      out.push(flow.get<El>('sourceRef'), flow.get<El>('targetRef'));
    }
    if (p.on) out.push(this.doc.require(p.on, 'bpmn:Activity', 'activity'));
    if (p.in) out.push(this.doc.requireScope(p.in));
    return out;
  }

  /** Whether `anchor` is a boundary event of `node` (a sibling in the scope that moves with it). */
  private static isBoundaryOf(node: El, anchor: El): boolean {
    return is(anchor, 'bpmn:BoundaryEvent') && anchor.get<El | undefined>('attachedToRef') === node;
  }

  /** Whether `anchor` moves with `node`: the node itself, one of its children, one of its boundary events. */
  private static isInside(node: El, anchor: El): boolean {
    return anchor === node || NodeMover.isBoundaryOf(node, anchor) || [...walk(node)].includes(anchor);
  }

  private static assertNotInside(node: El, anchor: El): void {
    if (NodeMover.isInside(node, anchor)) {
      const what = NodeMover.isBoundaryOf(node, anchor) ? 'that is one of its boundary events, which move with it' : 'that is the node itself or one of its children';
      throw modelError('E_INVALID_PLACEMENT', `${idOf(node)} cannot be moved relative to ${idOf(anchor)}: ${what}`, {
        element: idOf(node),
        related: [idOf(anchor)],
        hint: 'Pick an anchor outside the moved node.',
      });
    }
  }

  /** moveNode's own checks of the first node, in its order, before anything else looks at the placement. */
  private assertFirstPlacement(node: El, p: PlacementOptions): void {
    NodeMover.assertNotBoundary(node);
    for (const a of this.anchorsOf(p)) NodeMover.assertNotInside(node, a);
  }

  private static assertNotBoundary(node: El): void {
    if (is(node, 'bpmn:BoundaryEvent')) {
      throw modelError('E_INVALID_PLACEMENT', `Boundary event ${idOf(node)} is moved with --on <activityId>`, { element: idOf(node) });
    }
  }

  /**
   * The node a chain starts after (the --after anchor, the source of the
   * --flow) must not move with a later node of the chain (isInside: the node,
   * a child, a boundary event of it): the chain would be placed after itself
   * (E_INVALID_PLACEMENT). A --before anchor (or the target of the --flow)
   * that is a later node is fine: `move A Join --before Join` ends A -> Join;
   * one inside a later node is not (the chain would be placed inside itself).
   * The hint has the move of the first node alone, or, when that one is
   * already there, the move that puts it before the anchor. The first node is
   * checked by assertFirstPlacement.
   */
  private assertChainAnchor(nodes: El[], p: PlacementOptions): void {
    const mode = NodePlacement.modeOf(p);
    const later = nodes.slice(1);
    const flow = mode === 'flow' ? this.doc.require(p.flow!, 'bpmn:SequenceFlow', 'sequence flow') : undefined;
    const after = mode === 'after' || mode === 'between' ? this.doc.require(p.after!, 'bpmn:FlowNode') : flow?.get<El>('sourceRef');
    const before = mode === 'before' || mode === 'between' ? this.doc.require(p.before!, 'bpmn:FlowNode') : undefined;
    let anchor = after;
    let holder = after && later.find((n) => NodeMover.isInside(n, after));
    if (!holder && before) {
      anchor = before;
      holder = later.find((n) => n !== before && NodeMover.isInside(n, before));
    }
    if (!anchor || !holder) return;
    const ids = nodes.map(idOf);
    const first = ids[0]!;
    const what = anchor === holder ? 'is one of the moved nodes' : `is ${NodeMover.isBoundaryOf(holder, anchor) ? 'a boundary event of' : 'inside'} ${idOf(holder)}, one of the moved nodes`;
    const placement = flow ? `--flow ${idOf(flow)}` : [...(p.after ? [`--after ${p.after}`] : []), ...(p.before ? [`--before ${p.before}`] : [])].join(' ');
    const itself = `The chain would be placed ${anchor === before ? 'inside' : 'after'} itself.`;
    let hint = `${itself} Pick an anchor outside the moved nodes, or move ${first} alone: \`bpmn move <file> ${first} ${placement}\`.`;
    if (this.inPlace(nodes.slice(0, 1), p)) {
      // the first node alone is already there: that command would change nothing; before the anchor is the reorder
      const reorder = mode === 'after' && this.doc.incoming(anchor).length === 1;
      hint = `${itself} ${first} is already ${NodeMover.describePlacement(p)}. Pick an anchor outside the moved nodes${reorder ? `, or put ${first} before ${idOf(anchor)}: \`bpmn move <file> ${first} --before ${idOf(anchor)}\`` : ''}.`;
    }
    throw modelError('E_INVALID_PLACEMENT', `${flow ? `${idOf(flow)} cannot anchor the move of ${ids.join(', ')}: its source ${idOf(anchor)}` : `${idOf(anchor)} cannot anchor the move of ${ids.join(', ')}: it`} ${what}`, {
      element: flow ? idOf(flow) : idOf(anchor),
      related: ids,
      hint,
    });
  }

  /**
   * A move in place: the flow options describe the flow into the first node,
   * as on a splice (applyFlowOptions), and a flowId renames it (like `set
   * id=`, E_DUPLICATE_ID when the id is taken). One change entry for that flow.
   */
  private optionsOnInFlow(flow: El | undefined, p: PlacementOptions, cs: ChangeSet): void {
    if (!flow) return;
    const old = idOf(flow);
    const renamed = p.flowId !== undefined && p.flowId !== old;
    if (renamed) new IdRenamer(this.doc).rename(flow, p.flowId!);
    const options = new ChangeSet();
    new FlowOptions(p).apply(this.doc, flow, options);
    if (!renamed && !options.changed.length) return;
    cs.change(ChangeSet.flowEntryOf(flow, `${ChangeSet.flowEntryOf(flow).detail}${renamed ? ` (renamed from ${old})` : ''}`));
  }

  /**
   * Whether the placement leaves every node where it is (boundary events, a
   * node given twice and --flow never do): each later node follows the one
   * before through its only in-flow, and the chain sits at the placement:
   * --after X, X its first node's only predecessor through its only in-flow (X
   * no gateway: after one the chain is appended as a new branch); --before Y,
   * Y its last node's only successor through its only out-flow (Y no join:
   * before one the chain is prepended without a flow in); --after X --before
   * Y both. Flow options need a flow into the first node to describe (its
   * only in-flow, which a splice would give them). The move then changes
   * nothing but those; a note says so.
   */
  private inPlace(nodes: El[], p: PlacementOptions): boolean {
    if (nodes.some((n) => is(n, 'bpmn:BoundaryEvent')) || new Set(nodes).size !== nodes.length) return false;
    if (new FlowOptions(p).flags.length && this.doc.incoming(nodes[0]!).length !== 1) return false;
    const onlyIn = (n: El): El | undefined => {
      const flows = this.doc.incoming(n);
      return flows.length === 1 ? flows[0]!.get<El>('sourceRef') : undefined;
    };
    const onlyOut = (n: El): El | undefined => {
      const flows = this.doc.outgoing(n);
      return flows.length === 1 ? flows[0]!.get<El>('targetRef') : undefined;
    };
    for (let i = 1; i < nodes.length; i++) if (is(nodes[i - 1]!, 'bpmn:Gateway') || onlyIn(nodes[i]!) !== nodes[i - 1]) return false;
    const first = nodes[0]!;
    const last = nodes[nodes.length - 1]!;
    const mode = NodePlacement.modeOf(p);
    if (mode === 'after') {
      const x = this.doc.require(p.after!, 'bpmn:FlowNode');
      return !is(x, 'bpmn:Gateway') && onlyIn(first) === x;
    }
    if (mode === 'before') {
      const y = this.doc.require(p.before!, 'bpmn:FlowNode');
      return !(is(y, 'bpmn:Gateway') && this.doc.incoming(y).length >= 2) && onlyOut(last) === y;
    }
    if (mode === 'between') return onlyIn(first) === this.doc.require(p.after!, 'bpmn:FlowNode') && onlyOut(last) === this.doc.require(p.before!, 'bpmn:FlowNode');
    return false;
  }

  private deepestLane(el: El): El | undefined {
    const lanes = this.doc.lanesOf(el);
    return lanes[lanes.length - 1];
  }

  /**
   * Takes the node (and its boundary events) out of its current scope's
   * flowElements; lane membership is dropped when the process changes or the
   * target is a sub-process.
   */
  private leaveScope(moved: El[], oldScope: El | undefined, targetScope: El, cs: ChangeSet): void {
    const processChanged = !oldScope || this.doc.processOf(oldScope) !== this.doc.processOf(targetScope);
    const dropLanes = oldScope !== targetScope && (processChanged || !is(targetScope, 'bpmn:Process'));
    for (const n of moved) {
      if (dropLanes) {
        for (const lane of this.doc.lanesOf(n)) {
          removeFrom(lane, 'flowNodeRef', n);
          cs.change(ChangeSet.entryOf(lane, `member ${idOf(n)} removed`));
        }
      }
      if (oldScope) removeFrom(oldScope, 'flowElements', n);
    }
  }

  /**
   * After nodes arrived in `scope`: flows between nodes of the scope are
   * re-declared there, flows to nodes elsewhere are removed and reported.
   */
  private fixFlows(moved: El[], scope: El, cs: ChangeSet): void {
    const seen = new Set<El>();
    for (const n of moved) {
      for (const flow of [...this.doc.incoming(n), ...this.doc.outgoing(n)]) {
        if (seen.has(flow)) continue;
        seen.add(flow);
        const src = flow.get<El>('sourceRef');
        const tgt = flow.get<El>('targetRef');
        if (this.doc.scopeOf(src) === scope && this.doc.scopeOf(tgt) === scope) {
          const declaredIn = flow.$parent as El | undefined;
          if (declaredIn !== scope) {
            if (declaredIn) removeFrom(declaredIn, 'flowElements', flow);
            insertAfterInScope(scope, src, flow);
          }
          continue;
        }
        new SequenceFlows(this.doc).remove(flow, cs);
        cs.remove(ChangeSet.flowEntryOf(flow));
        cs.warn({
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
    if (!anchor || !is(scope, 'bpmn:Process') || this.doc.lanesOf(node).length) return;
    const lane = this.deepestLane(anchor);
    if (!lane) return;
    addTo(lane, 'flowNodeRef', node);
    for (const b of boundaries) if (!this.doc.lanesOf(b).length) addTo(lane, 'flowNodeRef', b);
  }

  /**
   * Keeps ids of flows removed during this command claimed: a flow the same
   * command creates afterwards must not reuse one, or the result would list the
   * id as both removed and created.
   */
  private reserveIds(ids: string[]): void {
    for (const id of ids) if (id && !this.doc.has(id)) this.doc.ids.claim(id);
  }

  private static labelOf(flow: El, source: El): FlowLabel {
    return { name: flow.get<string | undefined>('name'), condition: flow.get<El | undefined>('conditionExpression'), isDefault: source.get<El | undefined>('default') === flow };
  }

  /**
   * --after / --before / --flow: detach, then place like a new node
   * (`explicitLane`: op.lane assigns the lane afterwards). `spare`: the flows
   * this move took out, for the placement to put back; `chain`: the nodes moved
   * before this one (it is placed after it) and after it.
   */
  private moveNode(node: El, p: PlacementOptions, cs: ChangeSet, explicitLane: boolean, spare: Map<El, SpareFlow>, chain: { prev?: El; next?: El; bridges?: BridgeMade[] } = {}): DroppedLabel[] {
    const { prev, next } = chain;
    NodeMover.assertNotBoundary(node);
    const anchors = this.anchorsOf(p);
    for (const a of anchors) NodeMover.assertNotInside(node, a);
    const oldScope = this.doc.scopeOf(node);
    const targetScope = new NodePlacement(this.doc, p).scope();
    const boundaries = is(node, 'bpmn:Activity') ? this.doc.boundaryEventsOf(node) : [];
    const incoming = this.doc.incoming(node);
    const outgoing = this.doc.outgoing(node);
    const flowIds = [...incoming, ...outgoing].map(idOf);
    // with flow ids kept: the node's one out-flow, which the detach takes out, is put back at the new place
    const oldOut = outgoing.length === 1 && outgoing[0]!.get<El>('targetRef') !== node && this.doc.edit.keepsFlowId(outgoing[0]!) ? outgoing[0] : undefined;
    const oldTarget = oldOut?.get<El>('targetRef');
    const outLabel = oldOut && NodeMover.labelOf(oldOut, node);
    // ... and the flow from the node moved before (a -> b of `move a b`): when the detach takes it out (this node is not
    // bridged: an end event, a join), the append after that node puts it back as it was
    const fromPrev = prev && incoming.find((f) => f.get<El>('sourceRef') === prev && this.doc.edit.keepsFlowId(f));
    const prevLabel = fromPrev && NodeMover.labelOf(fromPrev, prev!);
    const bridge = new Bridge(this.doc, cs, 'move').single(node, true);
    if (bridge) chain.bridges?.push({ node, target: bridge.flow.get<El>('targetRef'), bridge });
    this.reserveIds(flowIds);
    // a bridge took the out-flow's name and condition (or warned); without one nothing did
    if (oldOut && oldTarget && !this.doc.has(idOf(oldOut))) spare.set(node, { flow: oldOut, target: oldTarget, ...(bridge ? {} : { label: outLabel }) });
    if (fromPrev && !this.doc.has(idOf(fromPrev)) && !spare.has(prev!)) spare.set(prev!, { flow: fromPrev, target: node, label: prevLabel });
    const laneBefore = laneOf(this.doc, node);
    this.leaveScope([node, ...boundaries], oldScope, targetScope, cs);
    this.doc.invalidate();
    // the lane, decided before the placement (a splice may rename the flow): a node in a lane keeps it, one without inherits add's
    const own = laneBefore && (laneBefore.get<El[] | undefined>('flowNodeRef') ?? []).includes(node) ? laneBefore : undefined;
    const inherited = !explicitLane && is(targetScope, 'bpmn:Process') ? LaneInheritance.of(this.doc, p) : LaneInheritance.NONE;
    // the next node of the chain is appended to a gateway (a new branch): the gateway's out-flow waits for that append
    const holdOwn = !!next && is(node, 'bpmn:Gateway');
    new NodePlacement(this.doc, p).place(node, cs, (source) => (source === node && holdOwn ? undefined : spare.get(source)?.flow));
    const dropped = this.reportPutBack(spare, cs);
    // the new place may give an event-based gateway a target BPMN 2.0 does not allow (like add / connect)
    for (const f of new Set([...this.doc.incoming(node), ...this.doc.outgoing(node)])) new EventGatewayRule(this.doc).warnFlow(f, cs);
    if (boundaries.length) insertAfterInScope(targetScope, node, ...boundaries);
    this.fixFlows(boundaries, targetScope, cs);
    if (own) {
      const note = explicitLane ? undefined : inherited.crossNote(idOf(node), own);
      if (note) cs.note(note);
    } else if (inherited.lane) {
      addTo(inherited.lane, 'flowNodeRef', node);
      for (const b of boundaries) if (!this.doc.lanesOf(b).length) addTo(inherited.lane, 'flowNodeRef', b);
      const warning = inherited.warning(idOf(node));
      if (warning) cs.warn(warning);
    }
    cs.change(ChangeSet.entryOf(node, `moved ${NodeMover.describePlacement(p)}`));
    cs.relocated.push(idOf(node));
    this.doc.invalidate();
    return dropped;
  }

  /**
   * The spare flows a placement put back (flow ids kept): each is one changed
   * entry, `<node> -> <new target> (was -> <old target>)`, instead of the
   * removed entry of the detach and the created entry of the placement. A
   * flow back between its old ends gets the label no bridge took back
   * (giveBack); one with another target drops it: W_LABEL_DROPPED /
   * W_CONDITION_DROPPED, returned for giveBackLate.
   */
  private reportPutBack(spare: Map<El, SpareFlow>, cs: ChangeSet): DroppedLabel[] {
    const dropped: DroppedLabel[] = [];
    for (const [node, { flow, target, label }] of spare) {
      if (this.doc.get(idOf(flow)) !== flow) continue;
      spare.delete(node);
      const id = idOf(flow);
      const back = flow.get<El>('targetRef') === target;
      const lost = label && back ? NodeMover.giveBack(node, flow, label, cs) : '';
      cs.removed = cs.removed.filter((c) => c.id !== id);
      cs.created = cs.created.filter((c) => c.id !== id);
      cs.change(ChangeSet.flowEntryOf(flow, `${ChangeSet.flowEntryOf(flow).detail}${back ? lost : ` (was -> ${idOf(target)})`}`));
      if (!label || back) continue;
      const why = `while moving ${idOf(node)}: ${idOf(node)} was not bridged, so nothing at its old place took it, and ${id} was put back at its new place without it`;
      const warnings: Warning[] = [];
      if (label.name) warnings.push({ code: 'W_LABEL_DROPPED', message: `Flow label "${label.name}" of ${id} was dropped ${why}`, element: id });
      if (label.condition) warnings.push({ code: 'W_CONDITION_DROPPED', message: `Condition of ${id} was dropped ${why}`, element: id });
      for (const w of warnings) cs.warn(w);
      dropped.push({ node, flow, target, label, warnings });
    }
    return dropped;
  }

  /**
   * Gives a put-back flow, back between its old ends, the label no bridge
   * took: the name and condition where the placement gave none, the default
   * marker where its source has no other default and the flow no condition.
   * A flow the placement made the default flow gets no condition
   * (W_CONDITION_DROPPED: a default flow has none). Returns the detail for a
   * default marker that could not come back.
   */
  private static giveBack(node: El, flow: El, label: FlowLabel, cs: ChangeSet): string {
    const id = idOf(flow);
    if (label.name && !flow.get<string | undefined>('name')) flow.set('name', label.name);
    if (label.condition && !flow.get<El | undefined>('conditionExpression')) {
      if (node.get<El | undefined>('default') === flow) {
        cs.warn({
          code: 'W_CONDITION_DROPPED',
          message: `Condition of ${id} was dropped while moving ${idOf(node)}: ${id} is now the default flow of ${idOf(node)}`,
          element: id,
          hint: `A default flow has no condition; use \`bpmn set <file> ${id} condition=...\` if the condition should replace the default marker.`,
        });
      } else {
        flow.set('conditionExpression', label.condition);
        label.condition.$parent = flow;
      }
    }
    if (!label.isDefault || node.get<El | undefined>('default') === flow) return '';
    if (!node.get<El | undefined>('default') && !flow.get<El | undefined>('conditionExpression')) {
      node.set('default', flow);
      return '';
    }
    return ` (no longer the default flow of ${idOf(node)})`;
  }

  /**
   * After the whole chain is placed: a flow whose label a placement dropped
   * that ends between its old ends again (a later node of the chain took it
   * back) gets it back after all, and the warnings that said otherwise go.
   * It is listed once, as a flow back between its old ends.
   */
  private giveBackLate(dropped: DroppedLabel[], cs: ChangeSet): void {
    for (const { node, flow, target, label, warnings } of dropped) {
      if (this.doc.get(idOf(flow)) !== flow || flow.get<El>('sourceRef') !== node || flow.get<El>('targetRef') !== target) continue;
      cs.warnings = cs.warnings.filter((w) => !warnings.includes(w));
      const lost = NodeMover.giveBack(node, flow, label, cs);
      const change = ChangeSet.flowEntryOf(flow);
      cs.changed = cs.changed.filter((c) => c.id !== change.id);
      cs.change(ChangeSet.flowEntryOf(flow, `${change.detail}${lost}`));
    }
  }

  /** With flow ids kept: the labels of the moved nodes' out-flows (the ones a placement may put back) before the move. */
  private labelsBefore(nodes: El[]): Map<El, LabelBefore> {
    const out = new Map<El, LabelBefore>();
    for (const n of nodes) {
      for (const f of this.doc.outgoing(n)) if (this.doc.edit.keepsFlowId(f)) out.set(f, { name: f.get<string | undefined>('name'), condition: f.get<El | undefined>('conditionExpression'), associations: [] });
    }
    if (!out.size) return out;
    for (const a of this.doc.byId().values()) {
      if (!is(a, 'bpmn:Association')) continue;
      for (const end of ['sourceRef', 'targetRef']) out.get(a.get<El>(end))?.associations.push(a);
    }
    return out;
  }

  /**
   * With flow ids kept, once the whole chain is placed: the out-flow of a
   * bridged node that a placement put back says what of its own (its label
   * before the move) a bridge keeps, by the bridge's id now, on its last
   * change entry: `(was -> C; its name and condition stay with the bridge
   * Flow_AToB)`. A later bridge of the chain that took it over is named
   * instead; nothing is said for what the flow has again, or what a later
   * bridge did not take (that detach warned). A bridge that a later node of
   * the chain removed (not bridged: an end event, a join) took it along: the
   * flow gets name and condition back when it ends between its old ends
   * (giveBack; it is then listed once), else W_LABEL_DROPPED /
   * W_CONDITION_DROPPED. Annotations go with a removed flow (reported).
   */
  private reportBridgesKept(made: BridgeMade[], before: Map<El, LabelBefore>, cs: ChangeSet): void {
    const alive = (el: El): boolean => this.doc.get(idOf(el)) === el;
    made.forEach(({ node, target, bridge }, i) => {
      const flow = bridge.from;
      const had = before.get(flow);
      if (!had || !alive(flow)) return;
      // where a value the bridge took is now: later bridges of the chain take it over; undefined when one did not take it
      const holder = (took: (b: BridgedFlow) => boolean): El | undefined => {
        let at = bridge.flow;
        for (const later of made.slice(i + 1)) {
          if (later.bridge.from !== at) continue;
          if (!took(later.bridge)) return undefined;
          at = later.bridge.flow;
        }
        return at;
      };
      const kept = new Map<El, string[]>();
      const keep = (at: El, what: string): void => {
        kept.set(at, [...(kept.get(at) ?? []), what]);
      };
      const lost: Array<{ what: 'name' | 'condition'; at: El }> = [];
      const { name, condition, associations } = bridge.took;
      if (name !== undefined && name === had.name && flow.get<string | undefined>('name') !== name) {
        const at = holder((b) => b.took.name === name);
        if (at && !alive(at)) lost.push({ what: 'name', at });
        else if (at?.get<string | undefined>('name') === name) keep(at, 'name');
      }
      if (condition && condition === had.condition && flow.get<El | undefined>('conditionExpression') !== condition) {
        const at = holder((b) => b.took.condition === condition);
        if (at && !alive(at)) lost.push({ what: 'condition', at });
        else if (at?.get<El | undefined>('conditionExpression') === condition) keep(at, 'condition');
      }
      for (const a of associations) {
        if (!had.associations.includes(a) || !alive(a)) continue;
        const at = holder((b) => b.took.associations.includes(a));
        if (at && alive(at) && (a.get<El>('sourceRef') === at || a.get<El>('targetRef') === at)) keep(at, 'annotation');
      }
      const id = idOf(flow);
      // back between its old ends, a flow gets what it has no other of back (giveBack), listed once (as giveBackLate does)
      const back = flow.get<El>('sourceRef') === node && flow.get<El>('targetRef') === target;
      const returned = lost.filter(({ what }) => back && !flow.get(what === 'name' ? 'name' : 'conditionExpression'));
      if (returned.length) {
        NodeMover.giveBack(node, flow, { name: returned.some((l) => l.what === 'name') ? name : undefined, condition: returned.some((l) => l.what === 'condition') ? condition : undefined, isDefault: false }, cs);
        cs.changed = cs.changed.filter((c) => c.id !== id);
        cs.change(ChangeSet.flowEntryOf(flow));
      }
      for (const { what, at } of lost.filter((l) => !returned.includes(l))) {
        const why = `while moving ${idOf(node)}: the bridge ${idOf(at)} took it, and a later node of the move removed ${idOf(at)}`;
        if (what === 'name') cs.warn({ code: 'W_LABEL_DROPPED', message: `Flow label "${name}" of ${id} was dropped ${why}`, element: id, related: [idOf(at)] });
        else cs.warn({ code: 'W_CONDITION_DROPPED', message: `Condition of ${id} was dropped ${why}`, element: id, related: [idOf(at)] });
      }
      if (!kept.size) return;
      const clause = [...kept].map(([at, what]) => {
        const notes = what.filter((w) => w === 'annotation').length;
        const items = [...what.filter((w) => w !== 'annotation'), ...(notes ? [notes > 1 ? 'annotations' : 'annotation'] : [])];
        const list = items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}` : items[0]!;
        return `its ${list} ${items.length > 1 || notes > 1 ? 'stay' : 'stays'} with the bridge ${idOf(at)}`;
      }).join('; ');
      const last = cs.changed.map((c) => c.id).lastIndexOf(id);
      const entry = last === -1 ? ChangeSet.flowEntryOf(flow) : cs.changed[last]!;
      const detail = entry.detail ?? '';
      const said = /\(was -> [^()]*\)$/.test(detail) ? `${detail.slice(0, -1)}; ${clause})` : `${detail}${detail ? ' ' : ''}(${clause})`;
      if (last === -1) cs.change(ChangeSet.about({ ...entry, detail: said }, flow));
      else cs.changed[last] = ChangeSet.about({ ...entry, detail: said }, flow);
    });
  }

  /** --in: append the nodes to the scope; the group is bridged, flows between its nodes survive, others are dropped. */
  private moveInto(nodes: El[], p: PlacementOptions, cs: ChangeSet): void {
    const scope = new NodePlacement(this.doc, p).scope();
    const relocating: El[] = [];
    for (const node of nodes) {
      if (is(node, 'bpmn:BoundaryEvent')) {
        throw modelError('E_INVALID_PLACEMENT', `Boundary event ${idOf(node)} is moved with --on <activityId>`, { element: idOf(node) });
      }
      NodeMover.assertNotInside(node, scope);
      if (this.doc.scopeOf(node) === scope) {
        cs.note(`${idOf(node)} is already in ${idOf(scope)}`);
        continue;
      }
      relocating.push(node);
    }
    new Bridge(this.doc, cs, 'move').group(relocating);
    const moved: El[] = [];
    for (const node of relocating) {
      const oldScope = this.doc.scopeOf(node);
      const boundaries = is(node, 'bpmn:Activity') ? this.doc.boundaryEventsOf(node) : [];
      this.leaveScope([node, ...boundaries], oldScope, scope, cs);
      insertAfterInScope(scope, undefined, node, ...boundaries);
      moved.push(node, ...boundaries);
      cs.change(ChangeSet.entryOf(node, `moved into ${idOf(scope)}`));
      cs.relocated.push(idOf(node));
    }
    this.fixFlows(moved, scope, cs);
    this.doc.invalidate();
  }

  /** --on: re-attach a boundary event to another activity. */
  private moveOnto(node: El, p: PlacementOptions, cs: ChangeSet): void {
    if (!is(node, 'bpmn:BoundaryEvent')) {
      throw modelError('E_INVALID_PLACEMENT', `--on attaches boundary events only; ${kindLabel(node)} ${idOf(node)} is moved with --after/--before/--flow/--in`, {
        element: idOf(node),
      });
    }
    const host = this.doc.require(p.on!, 'bpmn:Activity', 'activity');
    const oldHost = node.get<El | undefined>('attachedToRef');
    if (oldHost === host) {
      cs.note(`${idOf(node)} is already attached to ${idOf(host)}`);
      return;
    }
    const oldScope = this.doc.scopeOf(node);
    const scope = this.doc.scopeOf(host) ?? this.doc.defaultScope();
    this.leaveScope([node], oldScope, scope, cs);
    new NodePlacement(this.doc, { on: p.on! }).place(node, cs);
    this.fixFlows([node], scope, cs);
    this.inheritLane(node, [], host, scope);
    cs.change(ChangeSet.entryOf(node, `moved onto ${idOf(host)}${oldHost ? ` (was ${idOf(oldHost)})` : ''}`));
    this.doc.invalidate();
  }
}
