import { labelSize } from '../../utils/text.js';
import { METRICS } from '../../utils/sizes.js';
import { bottom, center, right, segmentHitsBox, dedupe, hitCount, pathHitsAny, properCross, toSegments, type Segment } from '../../utils/geom.js';
import type { Box, GEdge, GNode, LaneBandInfo, Point, ScopeLayout } from '../../di/types.js';
import { ScopeLabels } from './ScopeLabels.js';
import { XIndex } from './XIndex.js';
import { nameOf } from '../../utils/names.js';
import { boundaryLeft } from '../../utils/nodes.js';
import { obstacles, routedArtifacts } from '../../utils/scope.js';
import { Channels, type Channel } from './Channels.js';
import { BorderSlots } from './BorderSlots.js';

type ChosenChannel = { list: Channels; y: number; x1: number; x2: number };

type Route = { pts: Point[]; channel?: ChosenChannel; runsBelow?: boolean; runsAbove?: boolean };

/** How far a boundary event's run keeps from the shapes, labels and runs it passes. */
const RUN_CLEAR = 15;

/** How far a straight rise into a node's bottom keeps from the shapes beside its line. */
export const RISE_KEEP = 5;

/**
 * Orthogonal routing of a scope's sequence flows, relative to the scope: straight on one row,
 * drops to targets below, rises into the bottom of targets above, loops through a channel
 * below or over the top. Candidate ways are scored by shapes cut and lines crossed.
 */
export class ChannelRouter {
  private readonly layout: ScopeLayout;
  private readonly obstacleList: Box[];
  private readonly boxes: XIndex<Box>;
  private readonly channels = new Channels();
  private readonly topChannels = new Channels();
  private readonly allNodes: GNode[];
  private readonly routed = new XIndex<Segment>();
  private readonly usedBottom = new BorderSlots();
  private readonly usedTop = new BorderSlots();
  /** Default label spots: a loop channel through one would push the label away. */
  private readonly labelsBelow: Box[] = [];
  private readonly labelsAbove: Box[] = [];
  private readonly belowIndex: XIndex<Box>;
  private readonly aboveIndex: XIndex<Box>;
  /** Node and data label spots: an empty branch drawn straight keeps off them. */
  private readonly gatewaySpots = new Map<GNode, Box>();
  private readonly labelSpots: Box[];
  private readonly spotIndex: XIndex<Box>;
  /**
   * Empty branches whose split and join share a free row: straight when no flow is on that line
   * either, so they are routed after the other forward flows.
   */
  private readonly openRow: Set<GEdge>;
  private readonly flowLabels: Box[] = [];
  private readonly flowLabelIndex = new XIndex<Box>();
  /** gateways whose left vertex a straight empty branch takes: no loop enters there */
  private readonly leftTaken = new Set<GNode>();
  private readonly overTop = new XIndex<Segment>();
  /** each flow's segments in routing order, and the id in `routed` of each one's first */
  private readonly flowSegs: Segment[][] = [];
  private readonly firstIds: number[] = [];

  constructor(layout: ScopeLayout) {
    this.layout = layout;
    this.obstacleList = obstacles(layout);
    this.boxes = this.boxIndex(this.obstacleList);
    this.allNodes = [...layout.nodes, ...layout.nodes.flatMap((node) => node.boundary)];
    for (const node of layout.nodes) {
      const label = node.kind === 'start' || node.kind === 'end' || node.kind === 'event' ? ScopeLabels.of(node, 'event') : undefined;
      if (label) this.labelsBelow.push(label);
      for (const boundaryEvent of node.boundary) {
        const boundaryLabel = ScopeLabels.of(boundaryEvent, 'boundary');
        if (boundaryLabel) (boundaryEvent.onTop ? this.labelsAbove : this.labelsBelow).push(boundaryLabel);
      }
    }
    this.belowIndex = this.boxIndex(this.labelsBelow);
    this.aboveIndex = this.boxIndex(this.labelsAbove);
    for (const node of layout.nodes) {
      const label = node.kind === 'gateway' ? ScopeLabels.of(node, 'gateway') : undefined;
      if (label) this.gatewaySpots.set(node, label);
    }
    this.labelSpots = [...this.labelsBelow, ...this.labelsAbove, ...this.gatewaySpots.values(), ...routedArtifacts(layout).map((artifact) => (artifact.kind === 'annotation' ? undefined : ScopeLabels.of(artifact, 'data')))].filter((box): box is Box => !!box);
    this.spotIndex = this.boxIndex(this.labelSpots);
    this.openRow = new Set(layout.edges.filter((edge) => !edge.back && edge.bandY !== undefined && Math.abs(center(edge.source.box).y - center(edge.target.box).y) < 1 && !pathHitsAny(this.straightLine(edge.source, edge.target), [...this.obstacleList, ...this.labelSpots], [edge.source.box, edge.target.box])));
  }

  /**
   * Forward entries rising into a node's bottom, told from the placed nodes since the placer asks
   * before routing. A boundary event on its host's top border enters from above instead.
   */
  static risesInto(node: GNode): GEdge[] {
    return node.in.filter((edge) => !edge.back && !edge.source.onTop && (edge.bandY !== undefined || center(edge.source.box).y > center(node.box).y + 1));
  }

  static entriesFromBelow(node: GNode): GEdge[] {
    return node.kind === 'gateway' && node.in.filter((edge) => !edge.back).length >= 2 ? ChannelRouter.risesInto(node) : [];
  }

  /** Its band, a boundary event's run, else its source's centre. */
  static riseFrom(edge: GEdge): number {
    return edge.bandY ?? (edge.source.host ? bottom(edge.source.box) + RUN_CLEAR : center(edge.source.box).y);
  }

  static riseX(node: GNode): number {
    return ChannelRouter.riseSlots(node)[0]!;
  }

  /** Never on the drop line, so a node with one rises in beside it. */
  static riseSlots(node: GNode): number[] {
    const cands = ChannelRouter.bottomCandidates(node);
    return cands.length > 1 && node.out.some((edge) => !edge.back && center(edge.target.box).y > center(node.box).y + 1) ? cands.slice(1) : cands;
  }

  static dataX(node: GNode): number {
    const centerX = center(node.box).x;
    if (!node.boundary.length) return centerX + Math.min(30, node.box.width / 2 - 10);
    return boundaryLeft(node) ? centerX + 30 : centerX - 30;
  }

  static countCrossings(points: Point[], routed: Segment[] | XIndex<Segment>, stop = Infinity): number {
    let crossingCount = 0;
    for (const segment of toSegments(points)) {
      const count = (other: Segment): boolean => properCross(segment, other) && ++crossingCount >= stop;
      if (Array.isArray(routed) ? routed.some(count) : routed.each(Math.min(segment[0].x, segment[1].x), Math.max(segment[0].x, segment[1].x), count)) break;
    }
    return crossingCount;
  }

  /** The centre (or the part free of boundary events) first, then the sides. */
  private static bottomCandidates(node: GNode): number[] {
    const box = node.box;
    const centerX = center(box).x;
    if (!node.boundary.length) return box.width >= 100 ? [centerX, centerX - 25, centerX + 25] : [centerX];
    return boundaryLeft(node) ? [right(box) - 20, right(box) - 8] : [box.x + 20, box.x + 8];
  }

  /**
   * Routes forward flows, then loops with narrow spans first, so nested loops get the inner
   * channels. Channels and runs below a host's row (plus RUN_CLEAR) extend the content height.
   */
  route(): void {
    const { layout } = this;
    /**
     * Boundary events' flows after the others, so a run below a host sees what is drawn
     * there: lowest host first, then the rightmost event of a row; open rows last.
     */
    const forward = layout.edges.filter((edge) => !edge.back && !this.openRow.has(edge));
    const low = (edge: GEdge): number => bottom(edge.source.host!.box);
    const fromEvents = forward.filter((edge) => edge.source.host).sort((first, second) => low(second) - low(first) || center(second.source.box).x - center(first.source.box).x);
    forward.splice(0, forward.length, ...forward.filter((edge) => !edge.source.host), ...fromEvents, ...this.openRow);
    const loops = layout.edges.filter((edge) => edge.back).sort((first, second) => Math.abs(center(first.source.box).x - center(first.target.box).x) - Math.abs(center(second.source.box).x - center(second.target.box).x));
    for (const edge of [...forward, ...loops]) this.routeEdge(edge);
    this.markTopsUsed();
    const maxChannel = this.channels.lowest();
    const maxRun = Math.max(0, ...layout.edges.filter((edge) => edge.runsBelow).map((edge) => edge.points[1]!.y + RUN_CLEAR));
    layout.height = Math.max(layout.height, maxChannel + 10, maxRun);
    this.moveBelowTop();
  }

  /**
   * Crossing flow pairs, shapes cut (not own ends) and `labels` some flow runs through.
   * Each crossing pair counts once.
   */
  faults(labels: Box[] = []): { crossings: number; hits: number; labels: number } {
    const { routed, flowSegs, firstIds } = this;
    const owner = new Int32Array(routed.size);
    firstIds.forEach((id, flowIndex) => owner.fill(flowIndex, id));
    let crossings = 0, hits = 0;
    const lastFlowCrossing = new Array<number>(flowSegs.length).fill(-1);
    flowSegs.forEach((segs, flowIndex) => {
      const later = firstIds[flowIndex + 1] ?? routed.size;
      for (const segment of segs) {
        routed.each(
          Math.min(segment[0].x, segment[1].x),
          Math.max(segment[0].x, segment[1].x),
          (other, id) => {
            const otherFlow = owner[id]!;
            if (lastFlowCrossing[otherFlow] !== flowIndex && properCross(segment, other)) {
              lastFlowCrossing[otherFlow] = flowIndex;
              crossings++;
            }
          },
          later,
        );
      }
    });
    for (const edge of this.layout.edges) hits += hitCount(edge.points, this.boxes, [edge.source.box, edge.target.box, ...(edge.source.host ? [edge.source.host.box] : [])]);
    return { crossings, hits, labels: labels.filter((label) => routed.each(label.x, right(label), ([start, end]) => segmentHitsBox(start, end, label))).length };
  }

  private boxIndex(boxes: Box[]): XIndex<Box> {
    const index = new XIndex<Box>();
    for (const box of boxes) index.add(box, box.x, right(box));
    return index;
  }

  private addSegments(index: XIndex<Segment>, segments: Segment[]): void {
    for (const segment of segments) index.add(segment, Math.min(segment[0].x, segment[1].x), Math.max(segment[0].x, segment[1].x));
  }

  private routeEdge(edge: GEdge): void {
    const source = edge.source, target = edge.target;
    const sc = center(source.box), tc = center(target.box);
    const route = edge.back ? this.loopRoute(edge) : !source.onTop && Math.abs(sc.y - tc.y) < 1 ? this.sameRowRoute(edge) : !source.onTop && tc.y > sc.y ? this.downRoute(edge) : this.upRoute(edge);
    edge.points = dedupe(route.pts.map((point) => ({ x: Math.round(point.x), y: Math.round(point.y) })));
    edge.runsBelow = route.runsBelow;
    edge.runsAbove = route.runsAbove;
    const segs = toSegments(edge.points);
    this.firstIds.push(this.routed.size);
    this.flowSegs.push(segs);
    this.addSegments(this.routed, segs);
    if (route.runsAbove) this.addSegments(this.overTop, segs);
    const chosenChannel = route.channel;
    if (chosenChannel) chosenChannel.list.take(chosenChannel.y, chosenChannel.x1, chosenChannel.x2);
    edge.label = this.flowLabel(edge);
    if (edge.label) {
      this.flowLabels.push(edge.label);
      this.flowLabelIndex.add(edge.label, edge.label.x, right(edge.label));
    }
  }

  private bandOf(node: GNode): LaneBandInfo | undefined {
    return this.layout.laneBands?.find((band) => band.nodes.has(node.host ?? node));
  }

  private bottomSlot(node: GNode, len: number): number {
    const cands = ChannelRouter.bottomCandidates(node);
    const ok = (slotX: number): boolean => !pathHitsAny([{ x: slotX, y: bottom(node.box) }, { x: slotX, y: bottom(node.box) + len }], this.boxes, [node.box]);
    return cands.find((slotX) => ok(slotX) && !this.usedBottom.taken(node, slotX)) ?? cands.find(ok) ?? cands[0]!;
  }

  /** The same for every branch, so their labels line up. */
  private exitX(node: GNode): number {
    return ChannelRouter.bottomCandidates(node)[0]!;
  }

  /** A join fed from below leaves to targets below through its right vertex. */
  private joinFromBelow(node: GNode): boolean {
    return ChannelRouter.entriesFromBelow(node).length > 0;
  }

  /** Off-centre on an expanded sub-process: its name sits at the top centre. */
  private topX(node: GNode): number {
    return node.child ? node.box.x + Math.min(40, node.box.width / 4) : center(node.box).x;
  }

  private spanBottom(fromLayer: number, toLayer: number): number {
    let maxY = 0;
    for (const node of this.allNodes) {
      const layer = node.host ? node.host.layer : node.layer;
      if (layer >= fromLayer && layer <= toLayer) maxY = Math.max(maxY, bottom(node.box));
    }
    return maxY;
  }

  private rangeTop(x1: number, x2: number, band?: LaneBandInfo): number {
    const lo = Math.min(x1, x2), hi = Math.max(x1, x2);
    const inBand = (pointY: number): boolean => !band || (pointY >= band.top && pointY <= band.bottom);
    let minY = Infinity;
    for (const box of this.boxes.near(lo, hi)) if (box.x <= hi && right(box) >= lo && inBand(center(box).y)) minY = Math.min(minY, box.y);
    for (const label of this.aboveIndex.near(lo, hi)) if (label.x <= hi && right(label) >= lo && inBand(bottom(label))) minY = Math.min(minY, label.y);
    for (const [start, end] of this.routed.near(lo, hi)) {
      if (Math.max(start.x, end.x) >= lo && Math.min(start.x, end.x) <= hi && inBand(start.y) && inBand(end.y)) minY = Math.min(minY, start.y, end.y);
    }
    return minY === Infinity ? 0 : minY;
  }

  private rangeBottom(x1: number, x2: number, band?: LaneBandInfo): number {
    const lo = Math.min(x1, x2), hi = Math.max(x1, x2);
    const inBand = (pointY: number): boolean => !band || (pointY >= band.top && pointY <= band.bottom);
    let maxY = 0;
    for (const box of this.boxes.near(lo, hi)) if (box.x <= hi && right(box) >= lo && inBand(center(box).y)) maxY = Math.max(maxY, bottom(box));
    for (const label of this.belowIndex.near(lo, hi)) if (label.x <= hi && right(label) >= lo && inBand(label.y)) maxY = Math.max(maxY, bottom(label));
    for (const [start, end] of this.routed.near(lo, hi)) {
      if (Math.max(start.x, end.x) >= lo && Math.min(start.x, end.x) <= hi && inBand(start.y) && inBand(end.y)) maxY = Math.max(maxY, start.y, end.y);
    }
    return maxY;
  }

  private channelFor(fromX: number, toX: number, base: number): number {
    return this.channels.claim(fromX, toX, base, METRICS.loopGap / 2);
  }

  private exitToBelow(source: GNode, ex: number, channelY: number): Point[] {
    const sb = source.box;
    const direct: Point[] = [{ x: ex, y: bottom(sb) }, { x: ex, y: channelY }];
    if (!pathHitsAny(direct, this.boxes, [sb])) return direct;
    const gapX = right(sb) + METRICS.hGap / 2;
    const sideY = sb.y + sb.height * 0.75;
    const viaGap: Point[] = [{ x: right(sb), y: sideY }, { x: gapX, y: sideY }, { x: gapX, y: channelY }];
    return pathHitsAny(viaGap, this.boxes, [sb]) ? direct : viaGap;
  }

  /**
   * Into the target's bottom; around it through the gap right of it first, which is usually free of
   * join lines (they end at the target's column).
   */
  private hookFromBelow(target: GNode, fromY: number): Point[] {
    const tb = target.box;
    const tx = this.bottomSlot(target, 30);
    const hookY = bottom(tb) + 15;
    const direct: Point[] = [{ x: tx, y: fromY }, { x: tx, y: bottom(tb) }];
    if (fromY <= hookY || !pathHitsAny(direct, this.boxes, [tb])) return direct;
    for (const gapX of [right(tb) + METRICS.hGap / 2, tb.x - METRICS.hGap / 2]) {
      const path: Point[] = [{ x: gapX, y: fromY }, { x: gapX, y: hookY }, { x: tx, y: hookY }, { x: tx, y: bottom(tb) }];
      if (!pathHitsAny(path, this.boxes, [tb])) return path;
    }
    return direct;
  }

  /** One y for both ends: centres of either height parity are half a pixel apart. */
  private straightLine(source: GNode, target: GNode): Point[] {
    const lineY = Math.round((center(source.box).y + center(target.box).y) / 2);
    return [{ x: right(source.box), y: lineY }, { x: target.box.x, y: lineY }];
  }

  /** No routed flow on the horizontal `line` or its end vertices, and no flow label on it. */
  private lineFree(line: Point[]): boolean {
    const [start, end] = line as [Point, Point];
    const on = ([segStart, segEnd]: Segment): boolean => Math.min(segStart.y, segEnd.y) <= start.y && Math.max(segStart.y, segEnd.y) >= start.y && Math.min(segStart.x, segEnd.x) <= end.x && Math.max(segStart.x, segEnd.x) >= start.x && (segStart.y === segEnd.y || segStart.x === start.x || segStart.x === end.x);
    return !this.routed.near(Math.min(start.x, end.x), Math.max(start.x, end.x)).some(on) && !pathHitsAny(line, this.flowLabels, []);
  }

  /**
   * Boxes a run keeps off, routed horizontal runs included: two runs stack instead of sharing a
   * line.
   */
  private runArea(lo: number, hi: number): Box[] {
    return [
      ...this.boxes.near(lo, hi),
      ...this.spotIndex.near(lo, hi),
      ...this.flowLabelIndex.near(lo, hi),
      ...this.routed.near(lo, hi).flatMap(([start, end]): Box[] => (start.y === end.y ? [{ x: Math.min(start.x, end.x), y: start.y, width: Math.abs(end.x - start.x), height: 0 }] : [])),
    ];
  }

  /**
   * The highest y from RUN_CLEAR below `from` where a run keeps RUN_CLEAR from all of `area`.
   * Every move is to a height the run must at least have, so the result does not depend on the
   * order of the boxes.
   */
  private runBelow(x1: number, x2: number, from: number, area = this.runArea(Math.min(x1, x2), Math.max(x1, x2))): number {
    const lo = Math.min(x1, x2), hi = Math.max(x1, x2);
    const near = area.filter((box) => box.x < hi && right(box) > lo);
    let runY = from + RUN_CLEAR;
    for (let moved = true; moved; ) {
      moved = false;
      for (const box of near) {
        if (box.y < runY + RUN_CLEAR && bottom(box) + RUN_CLEAR > runY) {
          runY = bottom(box) + RUN_CLEAR;
          moved = true;
        }
      }
    }
    return runY;
  }

  private runAbove(x1: number, x2: number, from: number, area: Box[]): number {
    const lo = Math.min(x1, x2), hi = Math.max(x1, x2);
    const near = area.filter((box) => box.x < hi && right(box) > lo);
    let runY = from - RUN_CLEAR;
    for (let moved = true; moved; ) {
      moved = false;
      for (const box of near) {
        if (box.y < runY + RUN_CLEAR && bottom(box) + RUN_CLEAR > runY) {
          runY = box.y - RUN_CLEAR;
          moved = true;
        }
      }
    }
    return runY;
  }

  private onRouted(points: Point[], lines: XIndex<Segment> = this.routed): boolean {
    return toSegments(points.map((point) => ({ x: Math.round(point.x), y: Math.round(point.y) }))).some(([start, end]) =>
      lines.each(Math.min(start.x, end.x), Math.max(start.x, end.x), ([otherStart, otherEnd]) =>
        start.x === end.x
          ? otherStart.x === otherEnd.x && otherStart.x === start.x && Math.min(Math.max(start.y, end.y), Math.max(otherStart.y, otherEnd.y)) > Math.max(Math.min(start.y, end.y), Math.min(otherStart.y, otherEnd.y))
          : start.y === end.y && otherStart.y === otherEnd.y && otherStart.y === start.y && Math.min(Math.max(start.x, end.x), Math.max(otherStart.x, otherEnd.x)) > Math.max(Math.min(start.x, end.x), Math.min(otherStart.x, otherEnd.x)),
      ),
    );
  }

  /**
   * A self loop runs below the node. Otherwise exits and entries are combined and scored: a side
   * exit leaves a gateway beside its side vertex (off the diamond), a gateway target may be entered
   * at its left vertex since its bottom one carries the branch drops, and a join's entries share
   * its vertex but not with a loop leaving off the diamond. Running on a boundary event's way over
   * the top costs like a crossing; a way that cannot beat the best so far is not measured further
   * (each part only adds).
   */
  private loopRoute(edge: GEdge): Route {
    const source = edge.source, target = edge.target;
    const sb = source.box, tb = target.box;
    const sc = center(sb), tc = center(tb);
    const ignore = [sb, tb];
    const src = source.host ?? source;
    if (src === target) {
      const x1 = sb.x + sb.width * 0.7, x2 = sb.x + sb.width * 0.3;
      const loopY = bottom(sb) + 40;
      return { pts: [{ x: x1, y: bottom(sb) }, { x: x1, y: loopY }, { x: x2, y: loopY }, { x: x2, y: bottom(sb) }] };
    }
    const { channels, topChannels, usedBottom, usedTop } = this;
    const band = this.bandOf(src);
    const sameBand = band && band === this.bandOf(target) ? band : undefined;
    const x1 = tb.x - METRICS.hGap / 2, x2 = right(sb) + METRICS.hGap / 2;
    const ex = source.host ? sc.x : this.exitX(source);
    const tx = ChannelRouter.riseX(target);
    const sideY = sb.y + sb.height * 0.75;
    type Cand = { pts: Point[]; exit?: [BorderSlots, GNode, number]; entry?: [BorderSlots, GNode, number]; channel?: { list: Channels; y: number }; penalty: number; offDiamond?: boolean };
    const cands: Cand[] = [];
    const offDiamond = (ex2: { x?: number }): boolean => source.kind === 'gateway' && ex2.x === undefined;
    const base = this.rangeBottom(x1, x2, sameBand) + METRICS.loopGap;
    const channelY = channels.free(x1, x2, base, METRICS.loopGap / 2);
    const hookY = bottom(tb) + 15;
    const exits: Array<{ pts: Point[]; x?: number }> = [
      { pts: [{ x: ex, y: bottom(sb) }, { x: ex, y: channelY }], x: ex },
      { pts: [{ x: right(sb), y: sideY }, { x: x2, y: sideY }, { x: x2, y: channelY }] },
      { pts: [{ x: sb.x, y: sideY }, { x: sb.x - METRICS.hGap / 2, y: sideY }, { x: sb.x - METRICS.hGap / 2, y: channelY }] },
    ];
    const entries: Array<{ pts: Point[]; x?: number; penalty?: number }> = [
      { pts: [{ x: tx, y: channelY }, { x: tx, y: bottom(tb) }], x: tx },
      { pts: [{ x: right(tb) + METRICS.hGap / 2, y: channelY }, { x: right(tb) + METRICS.hGap / 2, y: hookY }, { x: tx, y: hookY }, { x: tx, y: bottom(tb) }], x: tx },
      { pts: [{ x: x1, y: channelY }, { x: x1, y: hookY }, { x: tx, y: hookY }, { x: tx, y: bottom(tb) }], x: tx },
    ];
    if (target.kind === 'gateway' && !this.leftTaken.has(target)) entries.push({ pts: [{ x: x1, y: channelY }, { x: x1, y: tc.y }, { x: tb.x, y: tc.y }], penalty: 1.5 });
    for (const ex2 of exits) {
      for (const en of entries) {
        cands.push({
          pts: [...ex2.pts, ...en.pts],
          exit: ex2.x !== undefined ? [usedBottom, source.host ?? source, ex2.x] : undefined,
          entry: en.x !== undefined ? [usedBottom, target, en.x] : undefined,
          channel: { list: channels, y: channelY },
          penalty: en.penalty ?? 0,
          offDiamond: offDiamond(ex2),
        });
      }
    }
    const topBase = this.rangeTop(x1, x2, sameBand) - METRICS.loopGap;
    const topY = topChannels.free(x1, x2, topBase, -METRICS.loopGap / 2);
    const ttx = this.topX(target);
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
          exit: ex2.x !== undefined ? [usedTop, source.host ?? source, ex2.x] : undefined,
          entry: en.x !== undefined ? [usedTop, target, en.x] : undefined,
          channel: { list: topChannels, y: topY },
          penalty: 0.5,
          offDiamond: offDiamond(ex2),
        });
      }
    }
    if (tb.y > bottom(sb)) {
      const midY = (bottom(sb) + tb.y) / 2;
      cands.push({ pts: [{ x: ex, y: bottom(sb) }, { x: ex, y: midY }, { x: ttx, y: midY }, { x: ttx, y: tb.y }], exit: [usedBottom, source.host ?? source, ex], entry: [usedTop, target, ttx], penalty: 0.25 });
      const sideX = ttx < sc.x ? sb.x : right(sb);
      cands.push({ pts: [{ x: sideX, y: sc.y }, { x: ttx, y: sc.y }, { x: ttx, y: tb.y }], entry: [usedTop, target, ttx], penalty: 0.25 });
    }
    let best: { cand: Cand; score: number } | undefined;
    cands.forEach((cand, candIndex) => {
      let score = cand.penalty + candIndex * 0.001;
      if (cand.exit && cand.exit[0].taken(cand.exit[1], cand.exit[2])) score += 2;
      if (cand.entry && cand.entry[0].taken(cand.entry[1], cand.entry[2], !cand.offDiamond)) score += 2;
      if (best && score >= best.score) return;
      score += hitCount(cand.pts, this.boxes, ignore) * 1000;
      if (best && score >= best.score) return;
      score += ChannelRouter.countCrossings(cand.pts, this.routed, best ? Math.ceil((best.score - score) / 3) : Infinity) * 3;
      if (this.overTop.size && !(best && score >= best.score) && this.onRouted(cand.pts, this.overTop)) score += 3;
      if (!best || score < best.score) best = { cand, score };
    });
    const win = best!.cand;
    if (win.exit) win.exit[0].take(win.exit[1], win.exit[2], true);
    if (win.entry) win.entry[0].take(win.entry[1], win.entry[2], false);
    return { pts: win.pts, ...(win.channel ? { channel: { list: win.channel.list, y: win.channel.y, x1, x2 } } : {}) };
  }

  /** A flow with a band runs in it, or straight when the row is free and crosses no more lines. */
  private sameRowRoute(edge: GEdge): Route {
    const source = edge.source, target = edge.target;
    const sb = source.box, tb = target.box;
    const ignore = [sb, tb];
    let pts = this.straightLine(source, target);
    if (edge.bandY !== undefined) {
      const ex = this.exitX(source);
      const band = [...this.exitToBelow(source, ex, edge.bandY), ...this.hookFromBelow(target, edge.bandY)];
      if (this.openRow.has(edge) && this.lineFree(pts) && ChannelRouter.countCrossings(pts, this.routed) <= ChannelRouter.countCrossings(band, this.routed)) this.leftTaken.add(target);
      else {
        pts = band;
        this.usedBottom.take(source, ex, true);
      }
    } else if (pathHitsAny(pts, this.boxes, ignore)) {
      const base = this.spanBottom(source.layer, target.layer) + METRICS.loopGap;
      const channelY = this.channelFor(this.exitX(source), tb.x - 20, base);
      pts = [...this.exitToBelow(source, this.exitX(source), channelY), ...this.hookFromBelow(target, channelY)];
    }
    return { pts };
  }

  /**
   * A join whose entries come from below (sharing its bottom vertex) leaves right and drops near
   * itself, off the middle of the column gap where loops and hooks run. A blocked boundary event's
   * flow goes down to a run below its host's row first, as out of its side it would run along the
   * host's bottom border. Else a channel below: in its own lane a run below the host, which the
   * lane grows to hold; to another lane it leaves the lane, which must not grow for it.
   */
  private downRoute(edge: GEdge): Route {
    const source = edge.source, target = edge.target;
    const sb = source.box, tb = target.box;
    const sc = center(sb), tc = center(tb);
    const ignore = [sb, tb];
    let runsBelow: boolean | undefined;
    const ex = source.host ? sc.x : this.exitX(source);
    let pts: Point[] = [{ x: ex, y: bottom(sb) }, { x: ex, y: tc.y }, { x: tb.x, y: tc.y }];
    const sideAt = (dropX: number): Point[] => [{ x: right(sb), y: sc.y }, { x: dropX, y: sc.y }, { x: dropX, y: tc.y }, { x: tb.x, y: tc.y }];
    const joinSide = this.joinFromBelow(source) ? [METRICS.hGap / 4, METRICS.hGap / 2].map((offset) => sideAt(right(sb) + offset)).find((path) => !pathHitsAny(path, this.boxes, ignore)) : undefined;
    if (joinSide) pts = joinSide;
    else if (pathHitsAny(pts, this.boxes, ignore)) {
      pts = sideAt(right(sb) + METRICS.hGap / 2);
      if (source.host) {
        const gx = right(source.host.box) + METRICS.hGap / 2, runY = this.runBelow(sc.x, gx, bottom(sb));
        const down = [{ x: sc.x, y: bottom(sb) }, { x: sc.x, y: runY }, { x: gx, y: runY }, { x: gx, y: tc.y }, { x: tb.x, y: tc.y }];
        if (runY < tc.y && !pathHitsAny(down, this.boxes, ignore)) {
          pts = down;
          runsBelow = true;
        }
      }
      if (pathHitsAny(pts, this.boxes, ignore)) {
        runsBelow = source.host && this.bandOf(source) === this.bandOf(target) ? true : undefined;
        const base = this.spanBottom(source.host ? source.host.layer : source.layer, target.layer) + METRICS.loopGap;
        const channelY = this.channelFor(ex, tb.x - 20, base);
        pts = [{ x: ex, y: bottom(sb) }, { x: ex, y: channelY }, { x: tb.x - 20, y: channelY }, { x: tb.x - 20, y: tc.y }, { x: tb.x, y: tc.y }];
      }
    } else this.usedBottom.take(source.host ?? source, ex, true);
    return { pts, runsBelow };
  }

  /**
   * A boundary event rises into free target slots keeping RISE_KEEP from every shape (a gateway's
   * vertex can lie on a side slot), through host gaps off the middle of the column gaps where loops
   * and hooks run; a short run passes under no other event of the host, whose drops lie there. A
   * longer way over the top must beat the faults of the best way below, and for a boundary event a
   * crossing or a label it runs through (its own, say) counts 3. A way that cannot beat the best is
   * neither made nor measured (each part only adds). Later loops and channels keep off a chosen run
   * over the top and the top point it enters, and a loop into the source's top keeps off a flow
   * leaving it there.
   */
  private upRoute(edge: GEdge): Route {
    const source = edge.source, target = edge.target;
    const sb = source.box, tb = target.box;
    const sc = center(sb), tc = center(tb);
    const ignore = [sb, tb];
    const { usedBottom, usedTop, topChannels } = this;
    let pts: Point[];
    let chosenChannel: ChosenChannel | undefined;
    let runsBelow: boolean | undefined;
    let runsAbove: boolean | undefined;
    const tx = ChannelRouter.riseX(target);
    const gapX = tb.x - METRICS.hGap / 2;
    /**
     * `x` / `top`: where it ends on the target's bottom / top; `over`: its run over the top;
     * `spare`: the target gateway's label, which moves to the upper left when its top is used.
     */
    type Way = { pts: Point[]; x?: number; below?: boolean; top?: number; over?: Channel; spare?: Box };
    const cands: Array<{ penalty?: number; make: () => Way | undefined }> = [];
    type OverEnd = { to: number; down: (runY: number) => Point[]; top?: number; penalty: number };
    /** Into the target's top or its left side from the gap before it, wherever no flow ends yet. */
    const overEnds = (): OverEnd[] => {
      const ttx = this.topX(target);
      const sideFree = !this.routed.near(tb.x - 1, tb.x + 1).some((seg) => seg.some((point) => Math.abs(point.x - tb.x) < 1 && point.y > tb.y && point.y < bottom(tb)));
      return [
        ...(usedTop.taken(target, ttx, true) ? [] : [{ to: ttx, down: (runY: number): Point[] => [{ x: ttx, y: runY }, { x: ttx, y: tb.y }], top: ttx, penalty: 0 }]),
        ...(sideFree ? [{ to: gapX, down: (runY: number): Point[] => [{ x: gapX, y: runY }, { x: gapX, y: tc.y }, { x: tb.x, y: tc.y }], penalty: 0.1 }] : []),
      ];
    };
    const overWay = (way: Point[], runY: number, x1: number, end: OverEnd, below?: boolean): Way | undefined => {
      if (pathHitsAny(way, this.boxes, ignore) || this.onRouted(way)) return undefined;
      const spare = end.top !== undefined ? this.gatewaySpots.get(target) : undefined;
      return { pts: way, ...(below ? { below } : {}), over: { y: runY, from: Math.min(x1, end.to), to: Math.max(x1, end.to) }, ...(end.top !== undefined ? { top: end.top } : {}), ...(spare ? { spare } : {}) };
    };
    if (source.host && source.onTop) {
      const band = this.bandOf(source);
      const ends = overEnds().filter((end) => end.top !== undefined || end.to - sc.x >= RUN_CLEAR);
      const area = this.runArea(Math.min(sc.x, ...ends.map((end) => end.to)), Math.max(sc.x, ...ends.map((end) => end.to)));
      const topArea = band ? area.filter((box) => center(box).y >= band.top && center(box).y <= band.bottom) : area;
      const from = Math.min(tb.y, sb.y);
      for (const end of ends) {
        cands.push({
          penalty: end.penalty,
          make: () => {
            const runY = this.runAbove(sc.x, end.to, from, topArea);
            return overWay([{ x: sc.x, y: sb.y }, { x: sc.x, y: runY }, ...end.down(runY)], runY, sc.x, end);
          },
        });
      }
    } else if (source.host) {
      const host = source.host;
      const band = this.bandOf(source);
      const slots = ChannelRouter.riseSlots(target).filter((slotX) => Math.abs(slotX - sc.x) >= RUN_CLEAR);
      const hookX = right(tb) + METRICS.hGap / 2;
      const hostGaps = [right(host.box) + METRICS.hGap / 4, host.box.x - (METRICS.hGap * 3) / 4];
      const area = this.runArea(Math.min(sc.x, gapX, hookX, ...slots, ...hostGaps), Math.max(sc.x, gapX, hookX, ...slots, ...hostGaps));
      const runs = new Map<number, number>();
      const runTo = (to: number): number => {
        let runY = runs.get(to);
        if (runY === undefined) runs.set(to, (runY = this.runBelow(sc.x, to, bottom(sb), area)));
        return runY;
      };
      const clear = (slotX: number): boolean => {
        const runY = runTo(slotX);
        return !this.boxes.near(slotX - RISE_KEEP, slotX + RISE_KEEP).some((box) => box !== tb && box.x - RISE_KEEP < slotX && slotX < right(box) + RISE_KEEP && box.y < runY && bottom(box) > bottom(tb));
      };
      const free = slots.filter((slotX) => clear(slotX) && !usedBottom.taken(target, slotX, true));
      const rises = free.length ? free : slots.filter(clear).slice(0, 1);
      const ways: Array<{ to: number; up: (runY: number) => Point[]; penalty: number; x?: number }> = [
        ...(rises.length ? rises : slots.slice(0, 1)).map((sx, riseIndex) => ({ to: sx, up: (runY: number): Point[] => [{ x: sx, y: runY }, { x: sx, y: bottom(tb) }], penalty: riseIndex * 0.1, x: sx })),
        ...(gapX - sc.x >= RUN_CLEAR ? [{ to: gapX, up: (runY: number): Point[] => [{ x: gapX, y: runY }, { x: gapX, y: tc.y }, { x: tb.x, y: tc.y }], penalty: 0.5 }] : []),
        { to: hookX, up: (runY: number): Point[] => this.hookFromBelow(target, runY), penalty: 1, x: tx },
      ];
      for (const { to, up, penalty, x: endX } of ways) {
        const way = (runY: number): Way => ({ pts: [{ x: sc.x, y: bottom(sb) }, { x: sc.x, y: runY }, ...up(runY)], ...(endX !== undefined ? { x: endX } : {}), below: true });
        cands.push({ penalty, make: () => way(runTo(to)) });
        cands.push({
          penalty: penalty + 1,
          make: () => {
            const near = runTo(to), deep = this.runBelow(sc.x, to, Math.max(near, this.rangeBottom(sc.x, to, band) + METRICS.loopGap) - RUN_CLEAR, area);
            return deep > near ? way(deep) : undefined;
          },
        });
      }
      /**
       * Over the top (one lane, or no lanes): ranked after every way below so it wins no tie, and
       * taken only with fewer crossings than the best way below has crossings and cuts.
       */
      if (!band || band === this.bandOf(target)) {
        const topArea = band ? area.filter((box) => center(box).y >= band.top && center(box).y <= band.bottom) : area;
        const from = Math.min(tb.y, host.box.y);
        const ends = overEnds();
        hostGaps.forEach((gx, gapIndex) => {
          if (gx < 0 || Math.abs(gx - sc.x) < RUN_CLEAR) return;
          if (host.boundary.some((boundaryEvent) => boundaryEvent !== source && !boundaryEvent.onTop && Math.min(gx, sc.x) < center(boundaryEvent.box).x && center(boundaryEvent.box).x < Math.max(gx, sc.x))) return;
          for (const end of ends) {
            if (end.top === undefined && gapX - gx < RUN_CLEAR) continue;
            cands.push({
              penalty: 2.5 + gapIndex * 0.2 + end.penalty,
              make: () => {
                const low = runTo(gx), runY = this.runAbove(gx, end.to, from, topArea);
                return overWay([{ x: sc.x, y: bottom(sb) }, { x: sc.x, y: low }, { x: gx, y: low }, { x: gx, y: runY }, ...end.down(runY)], runY, gx, end, true);
              },
            });
          }
        });
      }
    }
    const late = (rank: number): number | undefined => (source.host ? 100 + rank * 0.5 : undefined);
    cands.push({ penalty: late(0), make: () => ({ pts: [{ x: right(sb), y: sc.y }, { x: tx, y: sc.y }, { x: tx, y: bottom(tb) }], x: tx }) });
    cands.push({ penalty: late(1), make: () => ({ pts: [{ x: right(sb), y: sc.y }, ...this.hookFromBelow(target, sc.y)], x: tx }) });
    if (tb.x >= right(sb)) cands.push({ penalty: late(2), make: () => ({ pts: [{ x: sc.x, y: sb.y }, { x: sc.x, y: tc.y }, { x: tb.x, y: tc.y }] }) });
    if (gapX > right(sb)) cands.push({ penalty: late(3), make: () => ({ pts: [{ x: right(sb), y: sc.y }, { x: gapX, y: sc.y }, { x: gapX, y: tc.y }, { x: tb.x, y: tc.y }] }) });
    let best: (Way & { score: number; faults: number }) | undefined;
    let below: number | undefined;
    cands.forEach((cand, candIndex) => {
      let score = cand.penalty ?? candIndex * 0.5;
      if (best && score >= best.score) return;
      const way = cand.make();
      if (!way) return;
      if (way.over) below ??= best?.faults ?? Infinity;
      const hits = hitCount(way.pts, this.boxes, ignore);
      score += hits * 1000;
      if (best && score >= best.score) return;
      const per = source.host ? 3 : 1;
      const crossings = ChannelRouter.countCrossings(way.pts, this.routed, Math.min(best ? Math.ceil((best.score - score) / per) : Infinity, way.over ? below! : Infinity));
      if (way.over && crossings >= below!) return;
      score += per * crossings;
      if (source.host && !(best && score >= best.score)) score += 3 * (hitCount(way.pts, this.spotIndex, way.spare ? [way.spare] : []) + hitCount(way.pts, this.flowLabelIndex, []));
      if (!best || score < best.score) best = { ...way, score, faults: hits + crossings };
    });
    pts = best!.pts;
    if (best!.score < 1000) runsBelow = best!.below;
    if (best!.x !== undefined) usedBottom.take(target, best!.x, false);
    if (best!.score < 1000 && best!.over) {
      runsAbove = true;
      chosenChannel = { list: topChannels, y: best!.over.y, x1: best!.over.from, x2: best!.over.to };
      if (best!.top !== undefined) usedTop.take(target, best!.top, false);
    }
    if (best!.score < 1000 && pts[0]!.y === sb.y) usedTop.take(source, sc.x, true);
    if (best!.score >= 1000) {
      const base = this.spanBottom(source.layer, target.layer) + METRICS.loopGap;
      const channelY = this.channelFor(tb.x - METRICS.hGap / 2, this.exitX(source), base);
      pts = [...this.exitToBelow(source, this.exitX(source), channelY), ...this.hookFromBelow(target, channelY)];
    }
    return { pts, channel: chosenChannel, runsBelow, runsAbove };
  }

  private markTopsUsed(): void {
    const byTop = new Map<number, XIndex<GNode>>();
    for (const node of this.allNodes) {
      node.topUsed = false;
      const row = Math.floor(node.box.y);
      let list = byTop.get(row);
      if (!list) byTop.set(row, (list = new XIndex<GNode>()));
      list.add(node, node.box.x, right(node.box));
    }
    for (const edge of this.layout.edges) {
      for (const point of [edge.points[0]!, edge.points[edge.points.length - 1]!]) {
        if (!point) continue;
        for (let row = Math.floor(point.y) - 1; row <= Math.floor(point.y) + 1; row++) {
          for (const node of byTop.get(row)?.near(point.x, point.x) ?? []) if (Math.abs(point.y - node.box.y) < 1 && point.x >= node.box.x && point.x <= right(node.box)) node.topUsed = true;
        }
      }
    }
  }

  /** Loops over the top may have produced negative y: shift everything down. */
  private moveBelowTop(): void {
    const { layout } = this;
    let minY = 0;
    for (const edge of layout.edges) for (const point of edge.points) minY = Math.min(minY, point.y);
    for (const edge of layout.edges) if (edge.label) minY = Math.min(minY, edge.label.y);
    if (minY < 0) {
      const dy = -minY + 10;
      for (const node of layout.nodes) {
        node.box.y += dy;
        for (const boundaryEvent of node.boundary) boundaryEvent.box.y += dy;
      }
      for (const artifact of routedArtifacts(layout)) artifact.box.y += dy;
      for (const edge of layout.edges) {
        for (const point of edge.points) point.y += dy;
        if (edge.label) edge.label.y += dy;
        if (edge.bandY !== undefined) edge.bandY += dy;
      }
      for (const compensation of layout.compensations) for (const point of compensation.points) point.y += dy;
      if (layout.laneBands) for (const band of layout.laneBands) {
        band.top += dy;
        band.bottom += dy;
      }
      layout.height += dy;
    }
  }

  /**
   * A self loop's label goes below its bottom segment; others near the start of a horizontal
   * segment (for loops the right end), never past its end.
   */
  private flowLabel(edge: GEdge): Box | undefined {
    const name = nameOf(edge);
    if (!name) return undefined;
    const { width, height } = labelSize(name);
    const pts = edge.points;
    if (pts.length < 2) return undefined;
    if (edge.back && (edge.source.host ?? edge.source) === edge.target && pts.length === 4) {
      const start = pts[1]!, end = pts[2]!;
      return { x: Math.round((start.x + end.x) / 2 - width / 2), y: start.y + 4, width, height };
    }
    let start = pts[0]!, end = pts[1]!;
    let best = -1;
    for (let index = 0; index + 1 < pts.length; index++) {
      const len = Math.abs(pts[index + 1]!.x - pts[index]!.x);
      if (pts[index]!.y === pts[index + 1]!.y && len > best) {
        best = len;
        start = pts[index]!;
        end = pts[index + 1]!;
      }
    }
    if (start.y === end.y) {
      const lo = Math.min(start.x, end.x), hi = Math.max(start.x, end.x);
      const labelX = edge.back ? Math.max(lo + 2, hi - width - 8) : Math.min(lo + 8, Math.max(lo + 2, hi - width - 4));
      return { x: Math.round(labelX), y: start.y - height - 4, width, height };
    }
    return { x: start.x + 6, y: Math.min(start.y, end.y) + 6, width, height };
  }
}
