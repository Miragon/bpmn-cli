/**
 * Orthogonal edge routing for one scope (coordinates relative to the scope).
 *
 *  - same row: straight line at one y for both ends (centres of boxes whose
 *    heights differ in parity are half a pixel apart; a bypass underneath
 *    when something is in the way). An empty branch (a split's flow straight
 *    to its join) runs in its reserved band underneath, unless the row
 *    between split and join is free (in a laned scope the branches between
 *    them can run in other lanes): no shape, node label, flow or flow label
 *    on the line, no other flow on the split's right or the join's left
 *    vertex, and no more crossings than the band; then it is drawn straight
 *    (routed after the other forward flows, which it must see) and no loop
 *    enters that join through its left vertex
 *  - target below: down from the source, then right (branch drop); a gateway
 *    that merges flows, one of them rising into its bottom vertex (a join),
 *    leaves through its right vertex instead: right, down near the join (not
 *    in the middle of the column gap, where loops and hooks run), right. A
 *    split with one entry keeps its drops on the bottom vertex. Where the
 *    drop is blocked: right, down, right; a boundary event's down to a run
 *    below its host's row and right into the column gap after the host
 *    (runBelow), not out of its side along the host's bottom border. Where
 *    every such way cuts a shape: down to a channel below everything between
 *    the two (a boundary event's is a run below its host's row too, which
 *    its lane holds: GEdge.runsBelow)
 *  - target above: right from the source, then up into the target's bottom
 *    (a join, or any node a forward flow enters from below), straight under
 *    it: the placer keeps that column free between the node and its entries
 *    from below where that draws better (JoinColumnTrial);
 *    alternatives: hook from the column gap (elsewhere, and for loops and
 *    empty bands), up from the source's top and right into the target (that
 *    top point counts as used, so a loop into the source's top keeps off it
 *    like one into a bottom vertex with a drop), or into the target's left
 *    side. A boundary event leaves downwards instead, to a run RUN_CLEAR
 *    below the shapes and labels of its host's row (its own label included)
 *    and the runs of the flows routed before it, or below everything between
 *    the two in its lane, then up: straight, into the target's left side from
 *    the column gap before it, or a hook (in that order, where they cross as
 *    many lines and run through as many labels: each counts 3); or, where
 *    host and target share a lane (or there are no lanes), over the top: down
 *    to a short run into the column gap after the host (near it) or before it
 *    (near the node before; not under another event of the host, nor left of
 *    the scope's first column), up past the host's row, along a run RUN_CLEAR
 *    from the shapes, labels and runs of the lane in its x range (registered
 *    as a top channel; the scope, its lane or frame grows for the run and the
 *    flow's label, as for a loop over the top: the content moves down,
 *    LaneArranger fitLaneLoops), and down into the target's top (a gateway's top
 *    vertex) or into its left side from the gap before it. Such a way cuts no
 *    shape, runs on no routed flow, ranks after every way below (they win
 *    ties) and is taken only where it crosses fewer lines than the best way
 *    below crosses lines and cuts shapes. Out of the event's side along the
 *    host's bottom border only when every such way cuts a shape. No forward
 *    flow but such a way enters a top vertex: a target below is entered from
 *    the left
 *  - a boundary event on its host's top border (GNode.onTop, TopBorderTrial;
 *    wherever its target lies): straight up out of its top
 *    to a run RUN_CLEAR from the shapes, labels (its own above the host
 *    included) and runs of its lane in its x range, along, and down into the
 *    target's top or into its left side from the column gap before it, as
 *    over the top above (a top channel, GEdge.runsAbove; the scope grows for
 *    it), the out-of-the-side ways only when both cut a shape or run on a
 *    routed flow. Its flow is no entry from below (risesInto), and loops
 *    over the top keep above its label too
 *  - loops: down into a channel below everything in their column span (the
 *    default labels below events and boundary events included, so a label
 *    keeps its spot), left, up into the target's bottom; or over the top when
 *    that is cleaner. Every loop is scored over side/centre exits and
 *    entries: hits count 1000, crossings 3, running on a boundary event's way
 *    over the top 3, a border point already used by another flow 2
 *    (entering a gateway: only a point a flow leaving it uses, so a loop
 *    into a join shares the vertex with the join's other entries; not when
 *    the loop leaves a gateway by a side exit, which starts beside the
 *    diamond).
 *  - a gateway whose top a flow uses has its label to the upper left, clear
 *    of that flow also when bpmn-js draws the name on one line wider than
 *    the label box (it wraps at 90 px)
 *  - data associations are orthogonal stubs (vertical / horizontal / Z): LinkRouter
 */
import { labelSize } from '../../diagram/utils/text.js';
import { METRICS } from '../../diagram/utils/sizes.js';
import { center, segmentHitsBox } from '../../diagram/utils/geom.js';
import type { Box, GEdge, GNode, LaneBandInfo, Point, ScopeLayout } from '../../diagram/types.js';
import { ScopeLabels } from './ScopeLabels.js';
import { XIndex } from './XIndex.js';
import { bottom, dedupe, hitCount, pathHits, right, segmentsCross, toSegments, type Segment } from './utils/geometry.js';
import { nameOf } from './utils/names.js';
import { boundaryLeft } from './utils/nodes.js';
import { obstacles, routedArtifacts } from './utils/scope.js';

interface Channel {
  y: number;
  from: number;
  to: number;
}

/** the x positions on the bottom / top border of each node that flows use; `out`: a flow leaving the node there */
type Used = Map<GNode, Array<{ x: number; out: boolean }>>;

type ChosenChannel = { list: Channel[]; y: number; x1: number; x2: number };

/** a boundary event's way that runs below its host's row (GEdge.runsBelow), and then over the top (GEdge.runsAbove) */
type Route = { pts: Point[]; channel?: ChosenChannel; runsBelow?: boolean; runsAbove?: boolean };

/**
 * How far the way of a boundary event to a target above keeps from the shapes and labels it runs below (the
 * host's row, the event's own label): it leaves the event downwards to a run at least this far below them.
 */
export const RUN_CLEAR = 15;

/** How far a straight rise into a node's bottom keeps from the shapes beside its line (JoinColumnTrial takenColumns, the router's choice of slot). */
export const RISE_KEEP = 5;

/** Routes the sequence flows of a scope (route); then measures the routes with the indexes it built (faults). */
export class EdgeRouter {
  private readonly layout: ScopeLayout;
  private readonly obstacleList: Box[];
  /** the shapes and the segments routed so far, found by their x range */
  private readonly boxes: XIndex<Box>;
  private readonly channels: Channel[] = [];
  private readonly topChannels: Channel[] = [];
  private readonly allNodes: GNode[];
  private readonly routed = new XIndex<Segment>();
  private readonly usedBottom: Used = new Map();
  private readonly usedTop: Used = new Map();
  // the default spots of the labels below events and boundary events (a loop channel through one would push the label
  // away), and of those above the host of a boundary event on its top border
  private readonly labelsBelow: Box[] = [];
  private readonly labelsAbove: Box[] = [];
  private readonly belowIndex: XIndex<Box>;
  private readonly aboveIndex: XIndex<Box>;
  // the default spots of the node and data labels (an empty branch drawn straight keeps off them); a gateway's by its node
  private readonly gatewaySpots = new Map<GNode, Box>();
  private readonly labelSpots: Box[];
  private readonly spotIndex: XIndex<Box>;
  /**
   * empty branches whose split and join lie on one row with no shape and no node label between them (in a
   * laned scope the branches between them can run in other lanes): straight when no flow is on that line
   * either, so they are routed after the other forward flows
   */
  private readonly openRow: Set<GEdge>;
  /** the labels of the flows routed so far (also by their x range) */
  private readonly flowLabels: Box[] = [];
  private readonly flowLabelIndex = new XIndex<Box>();
  /** gateways whose left vertex an empty branch drawn straight takes (no loop enters there) */
  private readonly leftTaken = new Set<GNode>();
  /** the segments of the boundary events' ways over the top routed so far */
  private readonly overTop = new XIndex<Segment>();
  /** the segments of each flow in the order they are routed, and the id in `routed` of each one's first */
  private readonly flowSegs: Segment[][] = [];
  private readonly firstIds: number[] = [];

  constructor(layout: ScopeLayout) {
    this.layout = layout;
    this.obstacleList = obstacles(layout);
    this.boxes = this.boxIndex(this.obstacleList);
    this.allNodes = [...layout.nodes, ...layout.nodes.flatMap((n) => n.boundary)];
    for (const n of layout.nodes) {
      const label = n.kind === 'start' || n.kind === 'end' || n.kind === 'event' ? ScopeLabels.of(n, 'event') : undefined;
      if (label) this.labelsBelow.push(label);
      for (const b of n.boundary) {
        const bl = ScopeLabels.of(b, 'boundary');
        if (bl) (b.onTop ? this.labelsAbove : this.labelsBelow).push(bl);
      }
    }
    this.belowIndex = this.boxIndex(this.labelsBelow);
    this.aboveIndex = this.boxIndex(this.labelsAbove);
    for (const n of layout.nodes) {
      const label = n.kind === 'gateway' ? ScopeLabels.of(n, 'gateway') : undefined;
      if (label) this.gatewaySpots.set(n, label);
    }
    this.labelSpots = [...this.labelsBelow, ...this.labelsAbove, ...this.gatewaySpots.values(), ...routedArtifacts(layout).map((a) => (a.kind === 'annotation' ? undefined : ScopeLabels.of(a, 'data')))].filter((b): b is Box => !!b);
    this.spotIndex = this.boxIndex(this.labelSpots);
    this.openRow = new Set(layout.edges.filter((e) => !e.back && e.bandY !== undefined && Math.abs(center(e.source.box).y - center(e.target.box).y) < 1 && !pathHits(this.straightLine(e.source, e.target), [...this.obstacleList, ...this.labelSpots], [e.source.box, e.target.box])));
  }

  /**
   * The forward entries that rise into a node's bottom (riseX): from a source below it, or along an empty
   * branch's band; not the flow of a boundary event on its host's top border (GNode.onTop), which enters from above.
   * Told from the placed nodes, not from routes: the placer asks before routing (JoinColumnTrial), the
   * router before the entries are routed.
   */
  static risesInto(n: GNode): GEdge[] {
    return n.in.filter((e) => !e.back && !e.source.onTop && (e.bandY !== undefined || center(e.source.box).y > center(n.box).y + 1));
  }

  /** The entries of a join that rise into its bottom vertex (risesInto; none for a node that is no gateway or has fewer than two forward entries). */
  static entriesFromBelow(n: GNode): GEdge[] {
    return n.kind === 'gateway' && n.in.filter((e) => !e.back).length >= 2 ? EdgeRouter.risesInto(n) : [];
  }

  /** The height an entry from below rises from: its band's, a boundary event's run (at least RUN_CLEAR below the event), else its source's centre. */
  static riseFrom(e: GEdge): number {
    return e.bandY ?? (e.source.host ? bottom(e.source.box) + RUN_CLEAR : center(e.source.box).y);
  }

  /** The x on a node's bottom border where a flow rises in: the centre (beside the boundary events), beside the drop line when the node has one. */
  static riseX(n: GNode): number {
    return EdgeRouter.riseSlots(n)[0]!;
  }

  /** The x positions on a node's bottom border a flow may rise in at, riseX first (not on the drop line). */
  static riseSlots(n: GNode): number[] {
    const cands = EdgeRouter.bottomCandidates(n);
    return cands.length > 1 && n.out.some((e) => !e.back && center(e.target.box).y > center(n.box).y + 1) ? cands.slice(1) : cands;
  }

  /** x on a node's bottom border for data association stubs (beside the drop line, away from boundary events) */
  static dataX(n: GNode): number {
    const cx = center(n.box).x;
    if (!n.boundary.length) return cx + Math.min(30, n.box.width / 2 - 10);
    return boundaryLeft(n) ? cx + 30 : cx - 30;
  }

  static countCrossings(points: Point[], routed: Segment[] | XIndex<Segment>, stop = Infinity): number {
    let n = 0;
    for (const a of toSegments(points)) {
      const count = (b: Segment): boolean => segmentsCross(a, b) && ++n >= stop;
      if (Array.isArray(routed) ? routed.some(count) : routed.each(Math.min(a[0].x, a[1].x), Math.max(a[0].x, a[1].x), count)) break;
    }
    return n;
  }

  /**
   * Candidate x positions on the bottom border of a node for drops and rises:
   * the centre (or the free part beside the boundary events), then the sides.
   */
  private static bottomCandidates(n: GNode): number[] {
    const b = n.box;
    const cx = center(b).x;
    if (!n.boundary.length) return b.width >= 100 ? [cx, cx - 25, cx + 25] : [cx];
    return boundaryLeft(n) ? [right(b) - 20, right(b) - 8] : [b.x + 20, b.x + 8];
  }

  route(): void {
    const { layout } = this;
    // the flows of boundary events after the other forward flows, so a way below the host's row (runBelow) sees what is
    // drawn there: the lowest host first (its way up passes the rows above, whose runs then keep off it), of one row the
    // rightmost event first (its run is the highest: no drop of an event left of it crosses that); the open rows last
    const forward = layout.edges.filter((e) => !e.back && !this.openRow.has(e));
    const low = (e: GEdge): number => bottom(e.source.host!.box);
    const fromEvents = forward.filter((e) => e.source.host).sort((a, b) => low(b) - low(a) || center(b.source.box).x - center(a.source.box).x);
    forward.splice(0, forward.length, ...forward.filter((e) => !e.source.host), ...fromEvents, ...this.openRow);
    // loops: narrow spans first so nested loops get the inner channels
    const loops = layout.edges.filter((e) => e.back).sort((a, b) => Math.abs(center(a.source.box).x - center(a.target.box).x) - Math.abs(center(b.source.box).x - center(b.target.box).x));
    for (const e of [...forward, ...loops]) this.routeEdge(e);
    this.markTopsUsed();
    // channels extend the content height, as do the runs below their host's row (by RUN_CLEAR: a frame or an event
    // sub-process below keeps that far off)
    const maxChannel = Math.max(0, ...this.channels.map((c) => c.y));
    const maxRun = Math.max(0, ...layout.edges.filter((e) => e.runsBelow).map((e) => e.points[1]!.y + RUN_CLEAR));
    layout.height = Math.max(layout.height, maxChannel + 10, maxRun);
    this.moveBelowTop();
  }

  /** How the routes run: pairs of flows that cross, the shapes they cut (not their own ends, nor the host of a boundary event they leave) and the `labels` some flow runs through. */
  faults(labels: Box[] = []): { crossings: number; hits: number; labels: number } {
    const { routed, flowSegs, firstIds } = this;
    // the index of the flow that added each segment, by its id
    const owner = new Int32Array(routed.size);
    firstIds.forEach((id, i) => owner.fill(i, id));
    let crossings = 0, hits = 0;
    // the flows a later flow crosses, counted once each: met[j] is the last flow found crossing j
    const met = new Array<number>(flowSegs.length).fill(-1);
    flowSegs.forEach((segs, i) => {
      // the segments of the flows after this one
      const later = firstIds[i + 1] ?? routed.size;
      for (const s of segs) {
        routed.each(
          Math.min(s[0].x, s[1].x),
          Math.max(s[0].x, s[1].x),
          (q, id) => {
            const j = owner[id]!;
            if (met[j] !== i && segmentsCross(s, q)) {
              met[j] = i;
              crossings++;
            }
          },
          later,
        );
      }
    });
    for (const e of this.layout.edges) hits += hitCount(e.points, this.boxes, [e.source.box, e.target.box, ...(e.source.host ? [e.source.host.box] : [])]);
    return { crossings, hits, labels: labels.filter((l) => routed.each(l.x, right(l), ([a, b]) => segmentHitsBox(a, b, l))).length };
  }

  private boxIndex(boxes: Box[]): XIndex<Box> {
    const index = new XIndex<Box>();
    for (const b of boxes) index.add(b, b.x, right(b));
    return index;
  }

  private addSegments(index: XIndex<Segment>, segments: Segment[]): void {
    for (const s of segments) index.add(s, Math.min(s[0].x, s[1].x), Math.max(s[0].x, s[1].x));
  }

  private routeEdge(e: GEdge): void {
    const s = e.source, t = e.target;
    const sc = center(s.box), tc = center(t.box);
    const route = e.back ? this.loopRoute(e) : !s.onTop && Math.abs(sc.y - tc.y) < 1 ? this.sameRowRoute(e) : !s.onTop && tc.y > sc.y ? this.downRoute(e) : this.upRoute(e);
    e.points = dedupe(route.pts.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) })));
    e.runsBelow = route.runsBelow;
    e.runsAbove = route.runsAbove;
    const segs = toSegments(e.points);
    this.firstIds.push(this.routed.size);
    this.flowSegs.push(segs);
    this.addSegments(this.routed, segs);
    if (route.runsAbove) this.addSegments(this.overTop, segs);
    const chosenChannel = route.channel;
    if (chosenChannel) chosenChannel.list.push({ y: chosenChannel.y, from: Math.min(chosenChannel.x1, chosenChannel.x2), to: Math.max(chosenChannel.x1, chosenChannel.x2) });
    e.label = this.flowLabel(e);
    if (e.label) {
      this.flowLabels.push(e.label);
      this.flowLabelIndex.add(e.label, e.label.x, right(e.label));
    }
  }

  /** `x` is taken; for a flow entering a gateway only by a flow leaving it (a join's entries share the vertex) */
  private used(map: Used, n: GNode, x: number, entry = false): boolean {
    return (map.get(n) ?? []).some((u) => Math.abs(u.x - x) < 1 && (u.out || !entry || n.kind !== 'gateway'));
  }

  private use(map: Used, n: GNode, x: number, out: boolean): void {
    const list = map.get(n) ?? [];
    list.push({ x, out });
    map.set(n, list);
  }

  private bandOf(n: GNode): LaneBandInfo | undefined {
    return this.layout.laneBands?.find((b) => b.nodes.has(n.host ?? n));
  }

  /** x on the bottom border of `n` for a vertical stub of length `len` that hits nothing and is not yet used */
  private bottomSlot(n: GNode, len: number): number {
    const cands = EdgeRouter.bottomCandidates(n);
    const ok = (x: number): boolean => !pathHits([{ x, y: bottom(n.box) }, { x, y: bottom(n.box) + len }], this.boxes, [n.box]);
    return cands.find((x) => ok(x) && !this.used(this.usedBottom, n, x)) ?? cands.find(ok) ?? cands[0]!;
  }

  /** the "target below" drop x of a node (stable: the same for every branch, so labels line up) */
  private exitX(n: GNode): number {
    return EdgeRouter.bottomCandidates(n)[0]!;
  }

  /**
   * a gateway that merges flows, one of them rising into its bottom vertex (from a source below it, or an
   * empty branch's band): its exits to targets below leave through the right vertex, off that shared line
   * (the entries may be routed after the exit)
   */
  private joinFromBelow(n: GNode): boolean {
    return EdgeRouter.entriesFromBelow(n).length > 0;
  }

  /** x where a line enters an expanded sub-process from the top (off-centre: the name sits at the top centre) */
  private topX(n: GNode): number {
    return n.child ? n.box.x + Math.min(40, n.box.width / 4) : center(n.box).x;
  }

  /** lowest occupied y over a column span (layers), including boundary events */
  private spanBottom(fromLayer: number, toLayer: number): number {
    let maxY = 0;
    for (const n of this.allNodes) {
      const l = n.host ? n.host.layer : n.layer;
      if (l >= fromLayer && l <= toLayer) maxY = Math.max(maxY, bottom(n.box));
    }
    return maxY;
  }

  /** highest y (smallest) of any node, artifact, label above a boundary event's host or routed edge point inside an x range (restricted to a lane band) */
  private rangeTop(x1: number, x2: number, band?: LaneBandInfo): number {
    const lo = Math.min(x1, x2), hi = Math.max(x1, x2);
    const inBand = (y: number): boolean => !band || (y >= band.top && y <= band.bottom);
    let minY = Infinity;
    // the nodes, boundary events and artifacts
    for (const b of this.boxes.near(lo, hi)) if (b.x <= hi && right(b) >= lo && inBand(center(b).y)) minY = Math.min(minY, b.y);
    for (const l of this.aboveIndex.near(lo, hi)) if (l.x <= hi && right(l) >= lo && inBand(bottom(l))) minY = Math.min(minY, l.y);
    for (const [a, b] of this.routed.near(lo, hi)) {
      if (Math.max(a.x, b.x) >= lo && Math.min(a.x, b.x) <= hi && inBand(a.y) && inBand(b.y)) minY = Math.min(minY, a.y, b.y);
    }
    return minY === Infinity ? 0 : minY;
  }

  /** lowest y of any node, label below a node, artifact or routed edge point inside an x range (restricted to a lane band) */
  private rangeBottom(x1: number, x2: number, band?: LaneBandInfo): number {
    const lo = Math.min(x1, x2), hi = Math.max(x1, x2);
    const inBand = (y: number): boolean => !band || (y >= band.top && y <= band.bottom);
    let maxY = 0;
    // the nodes, boundary events and artifacts
    for (const b of this.boxes.near(lo, hi)) if (b.x <= hi && right(b) >= lo && inBand(center(b).y)) maxY = Math.max(maxY, bottom(b));
    for (const l of this.belowIndex.near(lo, hi)) if (l.x <= hi && right(l) >= lo && inBand(l.y)) maxY = Math.max(maxY, bottom(l));
    for (const [a, b] of this.routed.near(lo, hi)) {
      if (Math.max(a.x, b.x) >= lo && Math.min(a.x, b.x) <= hi && inBand(a.y) && inBand(b.y)) maxY = Math.max(maxY, a.y, b.y);
    }
    return maxY;
  }

  private freeChannel(list: Channel[], fromX: number, toX: number, base: number, step: number): number {
    const lo = Math.min(fromX, toX), hi = Math.max(fromX, toX);
    let y = base;
    while (list.some((c) => c.y === y && c.from <= hi && lo <= c.to)) y += step;
    return y;
  }

  private channelFor(fromX: number, toX: number, base: number): number {
    const y = this.freeChannel(this.channels, fromX, toX, base, METRICS.loopGap / 2);
    this.channels.push({ y, from: Math.min(fromX, toX), to: Math.max(fromX, toX) });
    return y;
  }

  /**
   * Path from `s` down to height `y`: straight drop at `ex` when the column
   * below is free, otherwise out of the right side into the column gap.
   */
  private exitToBelow(s: GNode, ex: number, y: number): Point[] {
    const sb = s.box;
    const direct: Point[] = [{ x: ex, y: bottom(sb) }, { x: ex, y }];
    if (!pathHits(direct, this.boxes, [sb])) return direct;
    const gapX = right(sb) + METRICS.hGap / 2;
    const sideY = sb.y + sb.height * 0.75;
    const viaGap: Point[] = [{ x: right(sb), y: sideY }, { x: gapX, y: sideY }, { x: gapX, y }];
    return pathHits(viaGap, this.boxes, [sb]) ? direct : viaGap;
  }

  /**
   * Path that reaches `t` from below starting at height `y` in the column gap
   * left of the target: up the gap, short hook right, into the bottom border.
   * Falls back to a straight rise at the entry x when the gap is blocked.
   */
  private hookFromBelow(t: GNode, y: number): Point[] {
    const tb = t.box;
    const tx = this.bottomSlot(t, 30);
    const hookY = bottom(tb) + 15;
    const direct: Point[] = [{ x: tx, y }, { x: tx, y: bottom(tb) }];
    if (y <= hookY || !pathHits(direct, this.boxes, [tb])) return direct;
    // the gap right of the target is usually free of join lines (they end at the target's column)
    for (const gapX of [right(tb) + METRICS.hGap / 2, tb.x - METRICS.hGap / 2]) {
      const path: Point[] = [{ x: gapX, y }, { x: gapX, y: hookY }, { x: tx, y: hookY }, { x: tx, y: bottom(tb) }];
      if (!pathHits(path, this.boxes, [tb])) return path;
    }
    return direct;
  }

  /** the straight line of a same-row flow, at one y for both ends (centres of either height parity are half a pixel apart) */
  private straightLine(s: GNode, t: GNode): Point[] {
    const y = Math.round((center(s.box).y + center(t.box).y) / 2);
    return [{ x: right(s.box), y }, { x: t.box.x, y }];
  }

  /** no routed flow on the horizontal `line` or on its ends (the split's right, the join's left vertex; crossing it is counted apart), no flow label */
  private lineFree(line: Point[]): boolean {
    const [a, b] = line as [Point, Point];
    const on = ([c, d]: Segment): boolean => Math.min(c.y, d.y) <= a.y && Math.max(c.y, d.y) >= a.y && Math.min(c.x, d.x) <= b.x && Math.max(c.x, d.x) >= a.x && (c.y === d.y || c.x === a.x || c.x === b.x);
    return !this.routed.near(Math.min(a.x, b.x), Math.max(a.x, b.x)).some(on) && !pathHits(line, this.flowLabels, []);
  }

  /** what a run between lo and hi keeps RUN_CLEAR from: the shapes, node labels, flow labels and horizontal runs of the flows routed so far there */
  private runArea(lo: number, hi: number): Box[] {
    return [
      ...this.boxes.near(lo, hi),
      ...this.spotIndex.near(lo, hi),
      ...this.flowLabelIndex.near(lo, hi),
      // the horizontal runs of the flows routed so far too (two such runs stack instead of sharing a line)
      ...this.routed.near(lo, hi).flatMap(([a, b]): Box[] => (a.y === b.y ? [{ x: Math.min(a.x, b.x), y: a.y, width: Math.abs(b.x - a.x), height: 0 }] : [])),
    ];
  }

  /**
   * the highest y from RUN_CLEAR below `from` at which a run from x1 to x2 keeps RUN_CLEAR from every shape, node
   * label, flow label and horizontal run it passes (`area`: runArea of a range that holds it, measured once for several runs)
   */
  private runBelow(x1: number, x2: number, from: number, area = this.runArea(Math.min(x1, x2), Math.max(x1, x2))): number {
    const lo = Math.min(x1, x2), hi = Math.max(x1, x2);
    const near = area.filter((b) => b.x < hi && right(b) > lo);
    // every move is to a height the run must at least have, so the result does not depend on the order of `near`
    let y = from + RUN_CLEAR;
    for (let moved = true; moved; ) {
      moved = false;
      for (const b of near) {
        if (b.y < y + RUN_CLEAR && bottom(b) + RUN_CLEAR > y) {
          y = bottom(b) + RUN_CLEAR;
          moved = true;
        }
      }
    }
    return y;
  }

  /** runBelow upwards: the lowest y from RUN_CLEAR above `from` at which a run from x1 to x2 keeps RUN_CLEAR from everything of `area` it passes */
  private runAbove(x1: number, x2: number, from: number, area: Box[]): number {
    const lo = Math.min(x1, x2), hi = Math.max(x1, x2);
    const near = area.filter((b) => b.x < hi && right(b) > lo);
    let y = from - RUN_CLEAR;
    for (let moved = true; moved; ) {
      moved = false;
      for (const b of near) {
        if (b.y < y + RUN_CLEAR && bottom(b) + RUN_CLEAR > y) {
          y = b.y - RUN_CLEAR;
          moved = true;
        }
      }
    }
    return y;
  }

  /** a segment of `points` (as drawn: rounded) runs on one of `lines` (on one line with it, sharing more than a point) */
  private onRouted(points: Point[], lines: XIndex<Segment> = this.routed): boolean {
    return toSegments(points.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }))).some(([a, b]) =>
      lines.each(Math.min(a.x, b.x), Math.max(a.x, b.x), ([c, d]) =>
        a.x === b.x
          ? c.x === d.x && c.x === a.x && Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) > Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y))
          : a.y === b.y && c.y === d.y && c.y === a.y && Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) > Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)),
      ),
    );
  }

  private loopRoute(e: GEdge): Route {
    const s = e.source, t = e.target;
    const sb = s.box, tb = t.box;
    const sc = center(sb), tc = center(tb);
    const ignore = [sb, tb];
    const src = s.host ?? s;
    if (src === t) {
      // self loop below the node
      const x1 = sb.x + sb.width * 0.7, x2 = sb.x + sb.width * 0.3;
      const y = bottom(sb) + 40;
      return { pts: [{ x: x1, y: bottom(sb) }, { x: x1, y }, { x: x2, y }, { x: x2, y: bottom(sb) }] };
    }
    const { channels, topChannels, usedBottom, usedTop } = this;
    const band = this.bandOf(src);
    const sameBand = band && band === this.bandOf(t) ? band : undefined;
    const x1 = tb.x - METRICS.hGap / 2, x2 = right(sb) + METRICS.hGap / 2;
    const ex = s.host ? sc.x : this.exitX(s);
    const tx = EdgeRouter.riseX(t);
    const sideY = sb.y + sb.height * 0.75;
    type Cand = { pts: Point[]; exit?: [Used, GNode, number]; entry?: [Used, GNode, number]; channel?: { list: Channel[]; y: number }; penalty: number; offDiamond?: boolean };
    const cands: Cand[] = [];
    // a side exit (no x) leaves the bounding box below / above the side vertex: off a gateway's diamond
    const offDiamond = (ex2: { x?: number }): boolean => s.kind === 'gateway' && ex2.x === undefined;
    // channel below every node and every routed edge between the two columns
    const base = this.rangeBottom(x1, x2, sameBand) + METRICS.loopGap;
    const y = this.freeChannel(channels, x1, x2, base, METRICS.loopGap / 2);
    const hookY = bottom(tb) + 15;
    const exits: Array<{ pts: Point[]; x?: number }> = [
      { pts: [{ x: ex, y: bottom(sb) }, { x: ex, y }], x: ex },
      { pts: [{ x: right(sb), y: sideY }, { x: x2, y: sideY }, { x: x2, y }] },
      { pts: [{ x: sb.x, y: sideY }, { x: sb.x - METRICS.hGap / 2, y: sideY }, { x: sb.x - METRICS.hGap / 2, y }] },
    ];
    const entries: Array<{ pts: Point[]; x?: number; penalty?: number }> = [
      { pts: [{ x: tx, y }, { x: tx, y: bottom(tb) }], x: tx },
      { pts: [{ x: right(tb) + METRICS.hGap / 2, y }, { x: right(tb) + METRICS.hGap / 2, y: hookY }, { x: tx, y: hookY }, { x: tx, y: bottom(tb) }], x: tx },
      { pts: [{ x: x1, y }, { x: x1, y: hookY }, { x: tx, y: hookY }, { x: tx, y: bottom(tb) }], x: tx },
    ];
    // a gateway's bottom vertex carries its branch drops, so a loop may enter through the left vertex instead
    if (t.kind === 'gateway' && !this.leftTaken.has(t)) entries.push({ pts: [{ x: x1, y }, { x: x1, y: tc.y }, { x: tb.x, y: tc.y }], penalty: 1.5 });
    for (const ex2 of exits) {
      for (const en of entries) {
        cands.push({
          pts: [...ex2.pts, ...en.pts],
          exit: ex2.x !== undefined ? [usedBottom, s.host ?? s, ex2.x] : undefined,
          entry: en.x !== undefined ? [usedBottom, t, en.x] : undefined,
          channel: { list: channels, y },
          penalty: en.penalty ?? 0,
          offDiamond: offDiamond(ex2),
        });
      }
    }
    // over the top: source top -> top channel -> target top (side exits / entries as above); slightly penalised
    const topBase = this.rangeTop(x1, x2, sameBand) - METRICS.loopGap;
    const topY = this.freeChannel(topChannels, x1, x2, topBase, -METRICS.loopGap / 2);
    const ttx = this.topX(t);
    const topHookY = tb.y - 15;
    const sideYTop = sb.y + sb.height * 0.25;
    const topExits: Array<{ pts: Point[]; x?: number }> = [
      { pts: [{ x: sc.x, y: sb.y }, { x: sc.x, y: topY }], x: sc.x },
      { pts: [{ x: right(sb), y: sideYTop }, { x: x2, y: sideYTop }, { x: x2, y: topY }] },
      { pts: [{ x: sb.x, y: sideYTop }, { x: sb.x - METRICS.hGap / 2, y: sideYTop }, { x: sb.x - METRICS.hGap / 2, y: topY }] },
    ];
    const topEntries: Array<{ pts: Point[]; x?: number }> = [
      { pts: [{ x: ttx, y: topY }, { x: ttx, y: tb.y }], x: ttx },
      { pts: [{ x: right(tb) + METRICS.hGap / 2, y: topY }, { x: right(tb) + METRICS.hGap / 2, y: topHookY }, { x: ttx, y: topHookY }, { x: ttx, y: tb.y }], x: ttx },
      { pts: [{ x: x1, y: topY }, { x: x1, y: topHookY }, { x: ttx, y: topHookY }, { x: ttx, y: tb.y }], x: ttx },
    ];
    for (const ex2 of topExits) {
      for (const en of topEntries) {
        cands.push({
          pts: [...ex2.pts, ...en.pts],
          exit: ex2.x !== undefined ? [usedTop, s.host ?? s, ex2.x] : undefined,
          entry: en.x !== undefined ? [usedTop, t, en.x] : undefined,
          channel: { list: topChannels, y: topY },
          penalty: 0.5,
          offDiamond: offDiamond(ex2),
        });
      }
    }
    // target below the source (lanes): straight down, or out of the side and down into the target's top
    if (tb.y > bottom(sb)) {
      const midY = (bottom(sb) + tb.y) / 2;
      cands.push({ pts: [{ x: ex, y: bottom(sb) }, { x: ex, y: midY }, { x: ttx, y: midY }, { x: ttx, y: tb.y }], exit: [usedBottom, s.host ?? s, ex], entry: [usedTop, t, ttx], penalty: 0.25 });
      const sideX = ttx < sc.x ? sb.x : right(sb);
      cands.push({ pts: [{ x: sideX, y: sc.y }, { x: ttx, y: sc.y }, { x: ttx, y: tb.y }], entry: [usedTop, t, ttx], penalty: 0.25 });
    }
    let best: { c: Cand; score: number } | undefined;
    cands.forEach((c, i) => {
      let score = c.penalty + i * 0.001;
      if (c.exit && this.used(c.exit[0], c.exit[1], c.exit[2])) score += 2;
      // a join's entries share its vertex, but not for a loop that leaves its gateway off the diamond to get there
      if (c.entry && this.used(c.entry[0], c.entry[1], c.entry[2], !c.offDiamond)) score += 2;
      // a way that cannot beat the best so far is not measured further (each part only adds)
      if (best && score >= best.score) return;
      score += hitCount(c.pts, this.boxes, ignore) * 1000;
      if (best && score >= best.score) return;
      score += EdgeRouter.countCrossings(c.pts, this.routed, best ? Math.ceil((best.score - score) / 3) : Infinity) * 3;
      // running on a boundary event's way over the top (a hook into a top along its run, say) costs like a crossing
      if (this.overTop.size && !(best && score >= best.score) && this.onRouted(c.pts, this.overTop)) score += 3;
      if (!best || score < best.score) best = { c, score };
    });
    const win = best!.c;
    if (win.exit) this.use(win.exit[0], win.exit[1], win.exit[2], true);
    if (win.entry) this.use(win.entry[0], win.entry[1], win.entry[2], false);
    return { pts: win.pts, ...(win.channel ? { channel: { list: win.channel.list, y: win.channel.y, x1, x2 } } : {}) };
  }

  private sameRowRoute(e: GEdge): Route {
    const s = e.source, t = e.target;
    const sb = s.box, tb = t.box;
    const ignore = [sb, tb];
    let pts = this.straightLine(s, t);
    if (e.bandY !== undefined) {
      // reserved empty band: drop, run along the band, hook into the join from below; straight when the row
      // between split and join is free and that crosses no more lines
      const ex = this.exitX(s);
      const band = [...this.exitToBelow(s, ex, e.bandY), ...this.hookFromBelow(t, e.bandY)];
      if (this.openRow.has(e) && this.lineFree(pts) && EdgeRouter.countCrossings(pts, this.routed) <= EdgeRouter.countCrossings(band, this.routed)) this.leftTaken.add(t);
      else {
        pts = band;
        this.use(this.usedBottom, s, ex, true);
      }
    } else if (pathHits(pts, this.boxes, ignore)) {
      const base = this.spanBottom(s.layer, t.layer) + METRICS.loopGap;
      const y = this.channelFor(this.exitX(s), tb.x - 20, base);
      pts = [...this.exitToBelow(s, this.exitX(s), y), ...this.hookFromBelow(t, y)];
    }
    return { pts };
  }

  private downRoute(e: GEdge): Route {
    const s = e.source, t = e.target;
    const sb = s.box, tb = t.box;
    const sc = center(sb), tc = center(tb);
    const ignore = [sb, tb];
    let runsBelow: boolean | undefined;
    // drop from the source (or from the boundary event), then right
    const ex = s.host ? sc.x : this.exitX(s);
    let pts: Point[] = [{ x: ex, y: bottom(sb) }, { x: ex, y: tc.y }, { x: tb.x, y: tc.y }];
    // right, down, right (the fallback below): a join's way out, as its entries from below share the bottom vertex,
    // down near the join when it can, off the middle of the column gap where loops and hooks run
    const sideAt = (x: number): Point[] => [{ x: right(sb), y: sc.y }, { x, y: sc.y }, { x, y: tc.y }, { x: tb.x, y: tc.y }];
    const joinSide = this.joinFromBelow(s) ? [METRICS.hGap / 4, METRICS.hGap / 2].map((d) => sideAt(right(sb) + d)).find((p) => !pathHits(p, this.boxes, ignore)) : undefined;
    if (joinSide) pts = joinSide;
    else if (pathHits(pts, this.boxes, ignore)) {
      // fall back: right, down, right; a boundary event's down to a run below its host's row first, then right to the
      // column gap after the host (out of the event's side it would run along the host's bottom border)
      pts = sideAt(right(sb) + METRICS.hGap / 2);
      if (s.host) {
        const gx = right(s.host.box) + METRICS.hGap / 2, y = this.runBelow(sc.x, gx, bottom(sb));
        const down = [{ x: sc.x, y: bottom(sb) }, { x: sc.x, y }, { x: gx, y }, { x: gx, y: tc.y }, { x: tb.x, y: tc.y }];
        if (y < tc.y && !pathHits(down, this.boxes, ignore)) {
          pts = down;
          runsBelow = true;
        }
      }
      if (pathHits(pts, this.boxes, ignore)) {
        // a boundary event's channel to a target in its own lane is a run below its host's row too: the lane holds it
        // (LaneArranger fitLaneLoops); to a target in another lane the channel leaves the lane, which must not grow for it
        runsBelow = s.host && this.bandOf(s) === this.bandOf(t) ? true : undefined;
        const base = this.spanBottom(s.host ? s.host.layer : s.layer, t.layer) + METRICS.loopGap;
        const y = this.channelFor(ex, tb.x - 20, base);
        pts = [{ x: ex, y: bottom(sb) }, { x: ex, y }, { x: tb.x - 20, y }, { x: tb.x - 20, y: tc.y }, { x: tb.x, y: tc.y }];
      }
    } else this.use(this.usedBottom, s.host ?? s, ex, true);
    return { pts, runsBelow };
  }

  private upRoute(e: GEdge): Route {
    const s = e.source, t = e.target;
    const sb = s.box, tb = t.box;
    const sc = center(sb), tc = center(tb);
    const ignore = [sb, tb];
    const { usedBottom, usedTop, topChannels } = this;
    let pts: Point[];
    let chosenChannel: ChosenChannel | undefined;
    let runsBelow: boolean | undefined;
    let runsAbove: boolean | undefined;
    // right, then up into the target's bottom (join)
    const tx = EdgeRouter.riseX(t);
    const gapX = tb.x - METRICS.hGap / 2;
    /**
     * a way in, with the x on the target's bottom it ends on (`top`: on its top, `over`: the run over the top, `spare`:
     * a label it may run through, the target gateway's, which goes to the upper left when its top vertex is used)
     */
    type Way = { pts: Point[]; x?: number; below?: boolean; top?: number; over?: Channel; spare?: Box };
    /** the ways in, best first (`penalty`: the order of a boundary event's, else by index), each made only when it can still win */
    const cands: Array<{ penalty?: number; make: () => Way | undefined }> = [];
    /** where a way over the top goes down from its run at y, how far the run goes, the x on the target's top it ends on, its rank */
    type OverEnd = { to: number; down: (y: number) => Point[]; top?: number; penalty: number };
    /**
     * the ends of a way over the top: down into the target's top (a gateway's top vertex, its label then goes to the
     * upper left) where no flow enters there yet, or into its left side from the column gap before it where no flow
     * ends on that side yet
     */
    const overEnds = (): OverEnd[] => {
      const ttx = this.topX(t);
      const sideFree = !this.routed.near(tb.x - 1, tb.x + 1).some((seg) => seg.some((p) => Math.abs(p.x - tb.x) < 1 && p.y > tb.y && p.y < bottom(tb)));
      return [
        ...(this.used(usedTop, t, ttx, true) ? [] : [{ to: ttx, down: (y: number): Point[] => [{ x: ttx, y }, { x: ttx, y: tb.y }], top: ttx, penalty: 0 }]),
        ...(sideFree ? [{ to: gapX, down: (y: number): Point[] => [{ x: gapX, y }, { x: gapX, y: tc.y }, { x: tb.x, y: tc.y }], penalty: 0.1 }] : []),
      ];
    };
    /** a way over the top along `way`, its run at y from x1 to the end; none where it cuts a shape or runs on a routed flow */
    const overWay = (way: Point[], y: number, x1: number, end: OverEnd, below?: boolean): Way | undefined => {
      if (pathHits(way, this.boxes, ignore) || this.onRouted(way)) return undefined;
      const spare = end.top !== undefined ? this.gatewaySpots.get(t) : undefined;
      return { pts: way, ...(below ? { below } : {}), over: { y, from: Math.min(x1, end.to), to: Math.max(x1, end.to) }, ...(end.top !== undefined ? { top: end.top } : {}), ...(spare ? { spare } : {}) };
    };
    if (s.host && s.onTop) {
      // a boundary event on its host's top border (TopBorderTrial): straight up out of its top to a run
      // RUN_CLEAR from the shapes, labels (its own above the host included) and runs of its lane between it and the end,
      // along, and down into the target as over the top below (a way to a gap less than RUN_CLEAR after it is none)
      const band = this.bandOf(s);
      const ends = overEnds().filter((end) => end.top !== undefined || end.to - sc.x >= RUN_CLEAR);
      const area = this.runArea(Math.min(sc.x, ...ends.map((end) => end.to)), Math.max(sc.x, ...ends.map((end) => end.to)));
      const topArea = band ? area.filter((b) => center(b).y >= band.top && center(b).y <= band.bottom) : area;
      const from = Math.min(tb.y, sb.y);
      for (const end of ends) {
        cands.push({
          penalty: end.penalty,
          make: () => {
            const y = this.runAbove(sc.x, end.to, from, topArea);
            return overWay([{ x: sc.x, y: sb.y }, { x: sc.x, y }, ...end.down(y)], y, sc.x, end);
          },
        });
      }
    } else if (s.host) {
      // a boundary event: down out of the event to a run below its host's row (clear of the shapes and labels it
      // passes), or below everything between the two in its lane where that crosses fewer lines, then up: straight,
      // into the target's left side from the column gap before it, or a hook from the gap beside it; else over the
      // top; along the host's bottom border only when every such way cuts a shape
      const host = s.host;
      const band = this.bandOf(s);
      // straight up at the slots of the target's bottom that are free and where the rise from the run keeps RISE_KEEP
      // from every shape (a gateway's vertex lies on the side slot of a task in its column; riseX first, the others a
      // little later: the one crossing fewer lines wins), else at the first where it does
      const slots = EdgeRouter.riseSlots(t).filter((x) => Math.abs(x - sc.x) >= RUN_CLEAR);
      const hookX = right(tb) + METRICS.hGap / 2;
      // where a way over the top rises: in the column gap after the host, near it, and in the one before it, near the
      // node before (off the middle of the gaps, where loops and hooks run; not right before the host's arrowhead)
      const hostGaps = [right(host.box) + METRICS.hGap / 4, host.box.x - (METRICS.hGap * 3) / 4];
      // what the runs of all these ways pass, measured once; the run up to each x, once
      const area = this.runArea(Math.min(sc.x, gapX, hookX, ...slots, ...hostGaps), Math.max(sc.x, gapX, hookX, ...slots, ...hostGaps));
      const runs = new Map<number, number>();
      const runTo = (to: number): number => {
        let y = runs.get(to);
        if (y === undefined) runs.set(to, (y = this.runBelow(sc.x, to, bottom(sb), area)));
        return y;
      };
      const clear = (x: number): boolean => {
        const y = runTo(x);
        return !this.boxes.near(x - RISE_KEEP, x + RISE_KEEP).some((b) => b !== tb && b.x - RISE_KEEP < x && x < right(b) + RISE_KEEP && b.y < y && bottom(b) > bottom(tb));
      };
      const free = slots.filter((x) => clear(x) && !this.used(usedBottom, t, x, true));
      const rises = free.length ? free : slots.filter(clear).slice(0, 1);
      /** how far the run goes, the way up from it, its rank, the x on the target's bottom it ends on */
      const ways: Array<{ to: number; up: (y: number) => Point[]; penalty: number; x?: number }> = [
        ...(rises.length ? rises : slots.slice(0, 1)).map((sx, k) => ({ to: sx, up: (y: number): Point[] => [{ x: sx, y }, { x: sx, y: bottom(tb) }], penalty: k * 0.1, x: sx })),
        ...(gapX - sc.x >= RUN_CLEAR ? [{ to: gapX, up: (y: number): Point[] => [{ x: gapX, y }, { x: gapX, y: tc.y }, { x: tb.x, y: tc.y }], penalty: 0.5 }] : []),
        { to: hookX, up: (y: number): Point[] => this.hookFromBelow(t, y), penalty: 1, x: tx },
      ];
      for (const { to, up, penalty, x } of ways) {
        const way = (y: number): Way => ({ pts: [{ x: sc.x, y: bottom(sb) }, { x: sc.x, y }, ...up(y)], ...(x !== undefined ? { x } : {}), below: true });
        cands.push({ penalty, make: () => way(runTo(to)) });
        cands.push({
          penalty: penalty + 1,
          make: () => {
            const near = runTo(to), deep = this.runBelow(sc.x, to, Math.max(near, this.rangeBottom(sc.x, to, band) + METRICS.loopGap) - RUN_CLEAR, area);
            return deep > near ? way(deep) : undefined;
          },
        });
      }
      // over the top (host and target in one lane, or no lanes): down out of the event to a short run into the column
      // gap after the host (or before it), up past the host's row to a run RUN_CLEAR from the shapes, labels and runs
      // of their lane between that gap and the target, along, and down into the target's top (a gateway's top vertex,
      // its label then goes to the upper left) or into its left side from the column gap before it, where no flow uses
      // that point yet; a way that cuts a shape or runs on a routed flow is none. Ranked after every way below (2.5 to
      // 2.8 against at most 2), so it wins no tie, and taken only with fewer crossings than the best way below crosses
      // lines and cuts shapes (see the scoring)
      if (!band || band === this.bandOf(t)) {
        const topArea = band ? area.filter((b) => center(b).y >= band.top && center(b).y <= band.bottom) : area;
        const from = Math.min(tb.y, host.box.y);
        const ends = overEnds();
        hostGaps.forEach((gx, k) => {
          // a gap before the scope's first column is none; the short run passes under no other event of the host's bottom
          // border (their drops, labels and compensation links, not all routed yet, lie there)
          if (gx < 0 || Math.abs(gx - sc.x) < RUN_CLEAR) return;
          if (host.boundary.some((b) => b !== s && !b.onTop && Math.min(gx, sc.x) < center(b.box).x && center(b.box).x < Math.max(gx, sc.x))) return;
          for (const end of ends) {
            if (end.top === undefined && gapX - gx < RUN_CLEAR) continue;
            cands.push({
              penalty: 2.5 + k * 0.2 + end.penalty,
              make: () => {
                const low = runTo(gx), y = this.runAbove(gx, end.to, from, topArea);
                return overWay([{ x: sc.x, y: bottom(sb) }, { x: sc.x, y: low }, { x: gx, y: low }, { x: gx, y }, ...end.down(y)], y, gx, end, true);
              },
            });
          }
        });
      }
    }
    const late = (j: number): number | undefined => (s.host ? 100 + j * 0.5 : undefined);
    cands.push({ penalty: late(0), make: () => ({ pts: [{ x: right(sb), y: sc.y }, { x: tx, y: sc.y }, { x: tx, y: bottom(tb) }], x: tx }) });
    cands.push({ penalty: late(1), make: () => ({ pts: [{ x: right(sb), y: sc.y }, ...this.hookFromBelow(t, sc.y)], x: tx }) });
    // up out of the source's top, then right into the target's left side (target in a lane above)
    if (tb.x >= right(sb)) cands.push({ penalty: late(2), make: () => ({ pts: [{ x: sc.x, y: sb.y }, { x: sc.x, y: tc.y }, { x: tb.x, y: tc.y }] }) });
    // into the target's left side through the column gap before it
    if (gapX > right(sb)) cands.push({ penalty: late(3), make: () => ({ pts: [{ x: right(sb), y: sc.y }, { x: gapX, y: sc.y }, { x: gapX, y: tc.y }, { x: tb.x, y: tc.y }] }) });
    /** the best way so far, with the lines it crosses and the shapes it cuts */
    let best: (Way & { score: number; faults: number }) | undefined;
    /**
     * the lines the best way below the host's row crosses and the shapes it cuts: a way over the top crosses fewer
     * lines (it is longer and crosses a flow into or out of the host; the labels a way below runs through move off it,
     * LabelDeclutter)
     */
    let below: number | undefined;
    cands.forEach((c, i) => {
      // a way that cannot beat the best so far is neither made nor measured further (each part only adds)
      let score = c.penalty ?? i * 0.5;
      if (best && score >= best.score) return;
      const w = c.make();
      if (!w) return;
      // the ways over the top come after every way below
      if (w.over) below ??= best?.faults ?? Infinity;
      const hits = hitCount(w.pts, this.boxes, ignore);
      score += hits * 1000;
      if (best && score >= best.score) return;
      // a boundary event's way: a crossing or a label it runs through (its own, say) counts 3
      const per = s.host ? 3 : 1;
      const crossings = EdgeRouter.countCrossings(w.pts, this.routed, Math.min(best ? Math.ceil((best.score - score) / per) : Infinity, w.over ? below! : Infinity));
      if (w.over && crossings >= below!) return;
      score += per * crossings;
      if (s.host && !(best && score >= best.score)) score += 3 * (hitCount(w.pts, this.spotIndex, w.spare ? [w.spare] : []) + hitCount(w.pts, this.flowLabelIndex, []));
      if (!best || score < best.score) best = { ...w, score, faults: hits + crossings };
    });
    pts = best!.pts;
    if (best!.score < 1000) runsBelow = best!.below;
    if (best!.x !== undefined) this.use(usedBottom, t, best!.x, false);
    // over the top: later loops and channels keep off its run, a loop into that top too (a join's shares it)
    if (best!.score < 1000 && best!.over) {
      runsAbove = true;
      chosenChannel = { list: topChannels, y: best!.over.y, x1: best!.over.from, x2: best!.over.to };
      if (best!.top !== undefined) this.use(usedTop, t, best!.top, false);
    }
    // up out of the source's top: a loop into that top keeps off it, as one into a bottom vertex keeps off a drop
    if (best!.score < 1000 && pts[0]!.y === sb.y) this.use(usedTop, s, sc.x, true);
    if (best!.score >= 1000) {
      const base = this.spanBottom(s.layer, t.layer) + METRICS.loopGap;
      const y = this.channelFor(tb.x - METRICS.hGap / 2, this.exitX(s), base);
      pts = [...this.exitToBelow(s, this.exitX(s), y), ...this.hookFromBelow(t, y)];
    }
    return { pts, channel: chosenChannel, runsBelow, runsAbove };
  }

  /** nodes whose top border carries a flow get their label beside (the nodes by the px row of their top and their x range, an end within 1 px) */
  private markTopsUsed(): void {
    const byTop = new Map<number, XIndex<GNode>>();
    for (const n of this.allNodes) {
      n.topUsed = false;
      const row = Math.floor(n.box.y);
      let list = byTop.get(row);
      if (!list) byTop.set(row, (list = new XIndex<GNode>()));
      list.add(n, n.box.x, right(n.box));
    }
    for (const e of this.layout.edges) {
      for (const p of [e.points[0]!, e.points[e.points.length - 1]!]) {
        if (!p) continue;
        for (let row = Math.floor(p.y) - 1; row <= Math.floor(p.y) + 1; row++) {
          for (const n of byTop.get(row)?.near(p.x, p.x) ?? []) if (Math.abs(p.y - n.box.y) < 1 && p.x >= n.box.x && p.x <= right(n.box)) n.topUsed = true;
        }
      }
    }
  }

  /** loops drawn over the top may have produced negative y: shift everything down */
  private moveBelowTop(): void {
    const { layout } = this;
    let minY = 0;
    for (const e of layout.edges) for (const p of e.points) minY = Math.min(minY, p.y);
    for (const e of layout.edges) if (e.label) minY = Math.min(minY, e.label.y);
    if (minY < 0) {
      const dy = -minY + 10;
      for (const n of layout.nodes) {
        n.box.y += dy;
        for (const b of n.boundary) b.box.y += dy;
      }
      for (const a of routedArtifacts(layout)) a.box.y += dy;
      for (const e of layout.edges) {
        for (const p of e.points) p.y += dy;
        if (e.label) e.label.y += dy;
        if (e.bandY !== undefined) e.bandY += dy;
      }
      for (const c of layout.compensations) for (const p of c.points) p.y += dy;
      if (layout.laneBands) for (const b of layout.laneBands) {
        b.top += dy;
        b.bottom += dy;
      }
      layout.height += dy;
    }
  }

  private flowLabel(e: GEdge): Box | undefined {
    const name = nameOf(e);
    if (!name) return undefined;
    const { width, height } = labelSize(name);
    const pts = e.points;
    if (pts.length < 2) return undefined;
    if (e.back && (e.source.host ?? e.source) === e.target && pts.length === 4) {
      // self loop: below the loop's bottom segment
      const a = pts[1]!, b = pts[2]!;
      return { x: Math.round((a.x + b.x) / 2 - width / 2), y: a.y + 4, width, height };
    }
    // longest horizontal segment (or the first segment)
    let a = pts[0]!, b = pts[1]!;
    let best = -1;
    for (let i = 0; i + 1 < pts.length; i++) {
      const len = Math.abs(pts[i + 1]!.x - pts[i]!.x);
      if (pts[i]!.y === pts[i + 1]!.y && len > best) {
        best = len;
        a = pts[i]!;
        b = pts[i + 1]!;
      }
    }
    if (a.y === b.y) {
      const lo = Math.min(a.x, b.x), hi = Math.max(a.x, b.x);
      // near the segment's start (for loops the start is the right end), never past its end
      const x = e.back ? Math.max(lo + 2, hi - width - 8) : Math.min(lo + 8, Math.max(lo + 2, hi - width - 4));
      return { x: Math.round(x), y: a.y - height - 4, width, height };
    }
    // vertical only: right of the segment
    return { x: a.x + 6, y: Math.min(a.y, b.y) + 6, width, height };
  }
}
