import type { Doc } from '../model/Doc.js';
import { modelError, usageError } from '../shared/utils/errors.js';
import { kindLabel } from '../model/utils/kinds.js';
import { addTo, is, removeFrom, walk, type El } from '../model/utils/moddle.js';
import { ChangeSet } from '../model/ChangeSet.js';
import { LaneEditor } from './participants/LaneEditor.js';
import { laneOf } from '../model/utils/lanes.js';
import { Bridge } from './flows/Bridge.js';
import { MovedFlows } from './flows/MovedFlows.js';
import { insertAfterInScope } from './utils/declaration-order.js';
import { LaneInheritance } from './participants/LaneInheritance.js';
import { IdRenamer } from './IdRenamer.js';
import { idOf } from '../model/utils/elements.js';
import { FlowOptions } from './flows/FlowOptions.js';
import type { MoveOp } from './types.js';
import { NodePlacement, type PlacementOptions } from './NodePlacement.js';
import { EventGatewayRule } from './events/EventGatewayRule.js';
import { SequenceFlows } from './flows/SequenceFlows.js';

/**
 * `move`: relocates nodes via --after/--before/--flow (chained in order), --in, --on or --lane.
 * The old place is bridged; with flow ids kept, a moved node's out-flow is put back at the
 * new place, keeping its id. A move that leaves every node where it is changes nothing.
 */
export class NodeMover {
  constructor(private readonly doc: Doc) {}

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
        const moved = new MovedFlows(this.doc, cs, nodes);
        nodes.forEach((node, i) => {
          const prev = nodes[i - 1];
          this.moveNode(node, prev ? { after: idOf(prev) } : placement, cs, hasLane, moved, { prev, next: nodes[i + 1] });
        });
        moved.finish();
      }
    }
    if (hasLane) {
      const lane = op.lane ? this.doc.require(op.lane, 'bpmn:Lane', 'lane') : undefined;
      for (const node of nodes) new LaneEditor(this.doc).assign(node, lane, cs);
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

  private static isBoundaryOf(node: El, anchor: El): boolean {
    return is(anchor, 'bpmn:BoundaryEvent') && anchor.get<El | undefined>('attachedToRef') === node;
  }

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
   * The chain must not start after a later node of itself. A --before anchor that is a later
   * node is fine (`move A Join --before Join` ends A -> Join).
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
      const reorder = mode === 'after' && this.doc.incoming(anchor).length === 1;
      hint = `${itself} ${first} is already ${NodeMover.describePlacement(p)}. Pick an anchor outside the moved nodes${reorder ? `, or put ${first} before ${idOf(anchor)}: \`bpmn move <file> ${first} --before ${idOf(anchor)}\`` : ''}.`;
    }
    throw modelError('E_INVALID_PLACEMENT', `${flow ? `${idOf(flow)} cannot anchor the move of ${ids.join(', ')}: its source ${idOf(anchor)}` : `${idOf(anchor)} cannot anchor the move of ${ids.join(', ')}: it`} ${what}`, {
      element: flow ? idOf(flow) : idOf(anchor),
      related: ids,
      hint,
    });
  }

  /** A move in place: flow options apply to the flow into the first node; a flowId renames it. */
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
   * Whether the placement leaves every node where it is. After a gateway the chain would be a
   * new branch, before a join a prepend, so neither counts as in place.
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

  /** Lane membership is dropped when the process changes or the target is a sub-process. */
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

  /** Re-declares flows within `scope`; flows that would cross scopes are removed and reported. */
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
    this.joinLane(lane, node, boundaries);
  }

  private joinLane(lane: El, node: El, boundaries: El[]): void {
    addTo(lane, 'flowNodeRef', node);
    for (const b of boundaries) if (!this.doc.lanesOf(b).length) addTo(lane, 'flowNodeRef', b);
  }

  /** A reused id would show up as both removed and created in the result. */
  private reserveIds(ids: string[]): void {
    for (const id of ids) if (id && !this.doc.has(id)) this.doc.ids.claim(id);
  }

  private moveNode(node: El, p: PlacementOptions, cs: ChangeSet, explicitLane: boolean, moved: MovedFlows, chain: { prev?: El; next?: El } = {}): void {
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
    const oldOut = outgoing.length === 1 && outgoing[0]!.get<El>('targetRef') !== node && this.doc.edit.keepsFlowId(outgoing[0]!) ? outgoing[0] : undefined;
    const oldTarget = oldOut?.get<El>('targetRef');
    const outLabel = oldOut && MovedFlows.labelOf(oldOut, node);
    // a -> b of `move a b`: when b is not bridged, the append after a puts the flow back as it was
    const fromPrev = prev && incoming.find((f) => f.get<El>('sourceRef') === prev && this.doc.edit.keepsFlowId(f));
    const prevLabel = fromPrev && MovedFlows.labelOf(fromPrev, prev!);
    const bridge = new Bridge(this.doc, cs, 'move').single(node, true);
    if (bridge) moved.bridged(node, bridge);
    this.reserveIds(flowIds);
    if (oldOut && oldTarget && !this.doc.has(idOf(oldOut))) moved.takeOut(node, oldOut, oldTarget, bridge ? undefined : outLabel);
    if (fromPrev && !this.doc.has(idOf(fromPrev)) && !moved.hasSpare(prev!)) moved.takeOut(prev!, fromPrev, node, prevLabel);
    const laneBefore = laneOf(this.doc, node);
    this.leaveScope([node, ...boundaries], oldScope, targetScope, cs);
    this.doc.invalidate();
    // decided before the placement: a splice may rename the flow
    const own = laneBefore && (laneBefore.get<El[] | undefined>('flowNodeRef') ?? []).includes(node) ? laneBefore : undefined;
    const inherited = !explicitLane && is(targetScope, 'bpmn:Process') ? LaneInheritance.of(this.doc, p) : LaneInheritance.NONE;
    // the gateway's out-flow waits for the append of the next node (a new branch)
    const holdOwn = !!next && is(node, 'bpmn:Gateway');
    new NodePlacement(this.doc, p).place(node, cs, (source) => (source === node && holdOwn ? undefined : moved.spareOf(source)));
    moved.putBack();
    for (const f of new Set([...this.doc.incoming(node), ...this.doc.outgoing(node)])) new EventGatewayRule(this.doc).warnFlow(f, cs);
    if (boundaries.length) insertAfterInScope(targetScope, node, ...boundaries);
    this.fixFlows(boundaries, targetScope, cs);
    if (own) {
      const note = explicitLane ? undefined : inherited.crossNote(idOf(node), own);
      if (note) cs.note(note);
    } else if (inherited.lane) {
      this.joinLane(inherited.lane, node, boundaries);
      const warning = inherited.warning(idOf(node));
      if (warning) cs.warn(warning);
    }
    cs.change(ChangeSet.entryOf(node, `moved ${NodeMover.describePlacement(p)}`));
    cs.relocated.push(idOf(node));
    this.doc.invalidate();
  }


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
