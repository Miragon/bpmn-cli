import { is, type El } from '../../../document/utils/moddle.js';
import { SIZES } from '../../utils/sizes.js';
import { center } from '../../utils/geom.js';
import type { Box, Point } from '../../di/types.js';
import { properCross, toSegments, type Segment } from '../../utils/geometry.js';
import { crossings } from '../../utils/routing.js';

export interface MessagePool {
  box: Box;
  /** leaf shapes only: no pools, lanes or expanded sub-process frames */
  obstacles: Box[];
  lines: Segment[];
  /** after the pool and lane headers */
  contentLeft: number;
}

export interface MessageFlowJob {
  el: El;
  source: El;
  target: El;
  sourceBox: Box;
  targetBox: Box;
  /** the end's boundary events: no obstacles, except those on its top border for a leg up */
  sourceOwn: Box[];
  targetOwn: Box[];
  sourcePool?: MessagePool;
  targetPool?: MessagePool;
}

/** cost of a flow between pools that are not neighbours, per pool in between */
const SKIP = 2;
/** more pools than this keep their declaration order (permutations explode) */
const MAX_PERMUTED = 6;
const JOG = 15;
/** a jog keeps this distance to the shapes beside its vertical */
const CLEAR = 20;
/** lines closer than this run "along" each other */
const NEAR = 8;

interface Leg {
  points: Point[];
  x: number;
}

interface Plan {
  job: MessageFlowJob;
  sourceLeg: Leg;
  targetLeg: Leg;
  sx: number;
  tx: number;
  gaps: number[];
  outside: boolean;
  down: boolean;
}

/**
 * Orders the pools of a collaboration so their message flows cut the fewest shapes, then routes
 * each flow: vertical legs out of its elements, a horizontal channel in the gap between pools.
 * Only a strictly better order replaces the declaration order.
 */
export class MessageFlowRouter {
  constructor(
    private readonly jobs: MessageFlowJob[],
    private readonly pools: MessagePool[],
  ) {}

  /**
   * The pool order whose message flows cut the fewest shapes; the hits of every end leaving upwards
   * / downwards do not depend on the order (a pool end has nothing in its way).
   */
  poolOrder(): MessagePool[] {
    const { pools, jobs } = this;
    if (pools.length < 2 || pools.length > MAX_PERMUTED || !jobs.length) return pools;
    const endCost = (box: Box, own: Box[], el: El, pool?: MessagePool): { up: number; down: number } => {
      const inside = is(el, 'bpmn:Participant') ? undefined : pool;
      return { up: this.straightHits(box, own, inside, true), down: this.straightHits(box, own, inside, false) };
    };
    const ends = jobs
      .filter((job) => job.sourcePool && job.targetPool && job.sourcePool !== job.targetPool)
      .map((job) => ({ sourcePool: job.sourcePool!, targetPool: job.targetPool!, source: endCost(job.sourceBox, job.sourceOwn, job.source, job.sourcePool), target: endCost(job.targetBox, job.targetOwn, job.target, job.targetPool) }));
    if (!ends.length) return pools;
    const cost = (order: MessagePool[]): number => {
      let total = 0;
      for (const end of ends) {
        const ia = order.indexOf(end.sourcePool), ib = order.indexOf(end.targetPool);
        const down = ia < ib;
        total += (down ? end.source.down : end.source.up) + (down ? end.target.up : end.target.down);
        total += SKIP * Math.max(0, Math.abs(ia - ib) - 1);
      }
      return total;
    };
    let best = pools;
    let bestCost = cost(pools);
    for (const order of this.permutations(pools)) {
      if (bestCost === 0) break;
      const orderCost = cost(order);
      if (orderCost < bestCost) {
        best = order;
        bestCost = orderCost;
      }
    }
    return best;
  }

  /**
   * Expects the pools in their final top-to-bottom order.
   * One channel per flow and gap, in the order with the fewest crossings (few flows per gap, so all
   * are tried; with more, flows that start further left get the upper channel). A straight flow
   * carries its label in the middle of the gap.
   */
  route(): Array<{ el: El; points: Point[]; channelY?: number }> {
    const { pools, jobs } = this;
    const rightEdge = Math.max(0, ...pools.map((pool) => pool.box.x + pool.box.width));
    const gapRange = (gapIndex: number): { top: number; bottom: number } => {
      const upper = pools[gapIndex], lower = pools[gapIndex + 1];
      const top = upper ? upper.box.y + upper.box.height : (lower?.box.y ?? 0) - SIZES.poolGap;
      const bottom = lower ? lower.box.y : (upper ? upper.box.y + upper.box.height : 0) + SIZES.poolGap;
      return { top, bottom };
    };
    const plans = jobs.map((job) => this.planOf(job));
    const channels = new Map<string, number>();
    const byGap = new Map<number, Plan[]>();
    for (const plan of plans) for (const gap of new Set(plan.gaps)) byGap.set(gap, [...(byGap.get(gap) ?? []), plan]);
    for (const [gap, list] of byGap) {
      const range = gapRange(gap);
      const level = (channelIndex: number, channelCount: number): number => Math.round(range.top + ((channelIndex + 1) * (range.bottom - range.top)) / (channelCount + 1));
      const sorted = [...list].sort((left, right) => Math.min(left.sx, left.tx) - Math.min(right.sx, right.tx));
      const order = sorted.length <= 5 ? this.bestChannelOrder(sorted, level, range) : sorted;
      order.forEach((plan, channelIndex) => channels.set(`${gap}|${plans.indexOf(plan)}`, level(channelIndex, order.length)));
    }
    return plans.map((plan, index) => {
      const { job, sx, tx, sourceLeg, targetLeg } = plan;
      const lead = sourceLeg.points;
      const tail = [...targetLeg.points].reverse();
      const sy = lead[lead.length - 1]!.y, ty = tail[0]!.y;
      let middle: Point[];
      let channelY: number | undefined;
      if (!plan.outside) {
        const channelHeight = channels.get(`${plan.gaps[0]}|${index}`) ?? Math.round((sy + ty) / 2);
        middle = Math.abs(sx - tx) < 1 ? [] : [{ x: sx, y: channelHeight }, { x: tx, y: channelHeight }];
        const range = gapRange(plan.gaps[0]!);
        channelY = middle.length ? channelHeight : Math.round((range.top + range.bottom) / 2);
      } else {
        const outX = Math.round(rightEdge + 30 + index * 25);
        const y1 = channels.get(`${plan.gaps[0]}|${index}`) ?? sy;
        const y2 = channels.get(`${plan.gaps[1]}|${index}`) ?? ty;
        middle = [{ x: sx, y: y1 }, { x: outX, y: y1 }, { x: outX, y: y2 }, { x: tx, y: y2 }];
        channelY = y1;
      }
      return { el: job.el, points: this.simplify([...lead, ...middle, ...tail]), ...(channelY !== undefined ? { channelY } : {}) };
    });
  }

  /** Above its channel segment in the gap between the pools; a straight flow's beside its line. */
  static label(pts: Point[], name: string, channelY?: number): Box {
    const width = Math.min(90, name.length * 7 + 4);
    const height = 14 * Math.max(1, Math.ceil((name.length * 7) / 90));
    const segmentIndex = channelY === undefined ? -1 : pts.findIndex((point, pointIndex) => pointIndex + 1 < pts.length && point.y === channelY && pts[pointIndex + 1]!.y === channelY);
    const horizontal = segmentIndex >= 0 ? [pts[segmentIndex]!, pts[segmentIndex + 1]!] : pts.length >= 3 ? [pts[1]!, pts[2]!] : [pts[0]!, pts[1]!];
    if (horizontal[0]!.y === horizontal[1]!.y) {
      return { x: Math.min(horizontal[0]!.x, horizontal[1]!.x) + 8, y: horizontal[0]!.y - height - 4, width, height };
    }
    const first = pts[0]!, second = pts[1]!;
    const labelCenterY = channelY !== undefined && pts.length === 2 ? channelY : (first.y + second.y) / 2;
    return { x: first.x + 6, y: labelCenterY - height / 2, width, height };
  }

  private cuts([start, end]: Segment, box: Box): boolean {
    return Math.min(start.x, end.x) < box.x + box.width - 1 && Math.max(start.x, end.x) > box.x + 1 && Math.min(start.y, end.y) < box.y + box.height - 1 && Math.max(start.y, end.y) > box.y + 1;
  }

  private hits(points: Point[], boxes: Box[]): number {
    let hitCount = 0;
    for (const box of boxes) if (toSegments(points).some((segment) => this.cuts(segment, box))) hitCount++;
    return hitCount;
  }

  private overlapLength(a1: number, a2: number, b1: number, b2: number): number {
    return Math.min(Math.max(a1, a2), Math.max(b1, b2)) - Math.max(Math.min(a1, a2), Math.min(b1, b2));
  }

  /** 300 per segment on top of a parallel line, 30 per one closer than NEAR (hard to tell apart) */
  private alongCost(points: Point[], lines: Segment[]): number {
    let cost = 0;
    for (const [start, end] of toSegments(points)) {
      const vertical = start.x === end.x;
      for (const [lineStart, lineEnd] of lines) {
        if (vertical ? lineStart.x !== lineEnd.x : lineStart.y !== lineEnd.y) continue;
        const off = vertical ? Math.abs(lineStart.x - start.x) : Math.abs(lineStart.y - start.y);
        if (off >= NEAR) continue;
        const len = vertical ? this.overlapLength(start.y, end.y, lineStart.y, lineEnd.y) : this.overlapLength(start.x, end.x, lineStart.x, lineEnd.x);
        if (len > 0) cost += off < 1 ? 300 : 30;
      }
    }
    return cost;
  }

  /** The pool's obstacles are the same box objects as the ends, so identity filters them. */
  private obstaclesFor(pool: MessagePool, box: Box, own: Box[], up = false): Box[] {
    const mine = up ? own.filter((obstacle) => !this.onTop(obstacle, box)) : own;
    return pool.obstacles.filter((obstacle) => obstacle !== box && !mine.includes(obstacle));
  }

  private onTop(obstacle: Box, box: Box): boolean {
    return center(obstacle).y < center(box).y;
  }

  /** Running on top of a drawn line counts as one more cut. */
  private straightHits(box: Box, own: Box[], pool: MessagePool | undefined, up: boolean): number {
    if (!pool) return 0;
    const centerX = Math.round(box.x + box.width / 2);
    const from = up ? box.y : box.y + box.height;
    const to = up ? pool.box.y : pool.box.y + pool.box.height;
    const line = [{ x: centerX, y: from }, { x: centerX, y: to }];
    return this.hits(line, this.obstaclesFor(pool, box, own, up)) + (this.alongCost(line, pool.lines) >= 300 ? 1 : 0);
  }

  /**
   * Xs for a vertical run through the gaps between obstacles: in a narrow gap the middle or beside
   * it (sequence flows use the middle), in a wide one near `near`.
   */
  private corridorXs(pool: MessagePool, obstacles: Box[], y1: number, y2: number, near: number): number[] {
    const lo = Math.min(y1, y2), hi = Math.max(y1, y2);
    const spans = obstacles
      .filter((obstacle) => obstacle.y < hi && obstacle.y + obstacle.height > lo)
      .map((obstacle) => [obstacle.x - CLEAR, obstacle.x + obstacle.width + CLEAR] as [number, number])
      .sort((first, second) => first[0] - second[0]);
    const left = pool.contentLeft + CLEAR, right = pool.box.x + pool.box.width - CLEAR;
    const out: number[] = [];
    let cursor = left;
    const gap = (gapStart: number, gapEnd: number): void => {
      if (gapEnd < gapStart) return;
      if (gapEnd - gapStart > 120) out.push(Math.round(Math.min(Math.max(near, gapStart + 20), gapEnd - 20)));
      else out.push(Math.round((gapStart + gapEnd) / 2), Math.round((gapStart + gapEnd) / 2 - Math.min(10, (gapEnd - gapStart) / 2)), Math.round((gapStart + gapEnd) / 2 + Math.min(10, (gapEnd - gapStart) / 2)));
    };
    for (const [spanStart, spanEnd] of spans) {
      gap(cursor, Math.min(spanStart, right));
      cursor = Math.max(cursor, spanEnd);
    }
    gap(cursor, right);
    return out;
  }

  /** On a task also beside the middle, which sequence flows use. */
  private exitXs(box: Box): number[] {
    const cx = Math.round(box.x + box.width / 2);
    return box.width >= 100 ? [cx, cx - 25, cx + 25] : [cx];
  }

  /**
   * A clean straight line where there is one (the middle first, else the one crossing the fewest
   * lines), else a jog clearing the boundary events hanging out of the border it leaves.
   */
  private legOf(box: Box, own: Box[], pool: MessagePool | undefined, up: boolean, el: El): Leg {
    const edge = up ? box.y : box.y + box.height;
    const exits = this.exitXs(box);
    const straight = (exitX: number): Leg => ({ points: [{ x: exitX, y: edge }], x: exitX });
    if (!pool || is(el, 'bpmn:Participant')) return straight(exits[0]!);
    const border = up ? pool.box.y : pool.box.y + pool.box.height;
    const obstacles = this.obstaclesFor(pool, box, own, up);
    const score = (pts: Point[]): number => this.hits(pts, obstacles) * 1000 + crossings(pts, pool.lines) * 5 + this.alongCost(pts, pool.lines);
    const clean = exits
      .map((exitX, exitIndex) => ({ x: exitX, line: [{ x: exitX, y: edge }, { x: exitX, y: border }], exitIndex }))
      .filter(({ line }) => !this.hits(line, obstacles) && this.alongCost(line, pool.lines) < 300)
      .map(({ x: exitX, line, exitIndex }) => ({ x: exitX, score: exitIndex === 0 ? -1 : crossings(line, pool.lines) * 5 + exitIndex }));
    if (clean.length) return straight(clean.reduce((bestExit, candidate) => (candidate.score < bestExit.score ? candidate : bestExit)).x);
    const reach = up ? Math.min(box.y, ...own.filter((boundaryEvent) => this.onTop(boundaryEvent, box)).map((boundaryEvent) => boundaryEvent.y)) : Math.max(box.y + box.height, ...own.map((boundaryEvent) => boundaryEvent.y + boundaryEvent.height));
    const jy = Math.round(up ? reach - JOG : reach + JOG);
    let best: { leg: Leg; score: number } = { leg: straight(exits[0]!), score: score([{ x: exits[0]!, y: edge }, { x: exits[0]!, y: border }]) };
    exits.forEach((ex, exitIndex) => {
      for (const corridorX of this.corridorXs(pool, obstacles, jy, border, ex)) {
        const points = [{ x: ex, y: edge }, { x: ex, y: jy }, { x: corridorX, y: jy }];
        const total = score([...points, { x: corridorX, y: border }]) + Math.abs(corridorX - ex) * 0.01 + exitIndex;
        if (total < best.score) best = { leg: { points, x: corridorX }, score: total };
      }
    });
    return best.leg;
  }

  private permutations<TItem>(list: TItem[]): TItem[][] {
    if (list.length <= 1) return [list];
    const out: TItem[][] = [];
    list.forEach((item, index) => {
      for (const rest of this.permutations([...list.slice(0, index), ...list.slice(index + 1)])) out.push([item, ...rest]);
    });
    return out;
  }

  private gapPolyline(sx: number, tx: number, channelHeight: number, above: number, below: number): Point[] {
    return [{ x: sx, y: above }, { x: sx, y: channelHeight }, { x: tx, y: channelHeight }, { x: tx, y: below }];
  }

  private bestChannelOrder<TPlan extends { sx: number; tx: number; down: boolean }>(list: TPlan[], level: (channelIndex: number, channelCount: number) => number, range: { top: number; bottom: number }): TPlan[] {
    const crossingsOf = (order: TPlan[]): number => {
      const lines = order.map((plan, index) => this.gapPolyline(plan.sx, plan.tx, level(index, order.length), plan.down ? range.top - 1 : range.bottom + 1, plan.down ? range.bottom + 1 : range.top - 1));
      let crossingCount = 0;
      for (let index = 0; index < lines.length; index++) {
        for (let otherIndex = index + 1; otherIndex < lines.length; otherIndex++) {
          for (const segment of toSegments(lines[index]!)) for (const otherSegment of toSegments(lines[otherIndex]!)) if (properCross(segment, otherSegment)) crossingCount++;
        }
      }
      return crossingCount;
    };
    let best = list;
    let bestCount = crossingsOf(list);
    const permute = (rest: TPlan[], acc: TPlan[]): void => {
      if (bestCount === 0) return;
      if (!rest.length) {
        const crossingCount = crossingsOf(acc);
        if (crossingCount < bestCount) {
          bestCount = crossingCount;
          best = acc;
        }
        return;
      }
      rest.forEach((item, index) => permute([...rest.slice(0, index), ...rest.slice(index + 1)], [...acc, item]));
    };
    permute(list, []);
    return best;
  }

  private poolDockX(box: Box, otherX: number): number {
    return Math.round(Math.min(Math.max(otherX, box.x + 40), box.x + box.width - 40));
  }

  private planOf(job: MessageFlowJob): Plan {
    const indexOf = (pool?: MessagePool): number => (pool ? this.pools.indexOf(pool) : -1);
    const sourceIndex = indexOf(job.sourcePool), targetIndex = indexOf(job.targetPool);
    const down = sourceIndex < targetIndex || (sourceIndex === targetIndex && center(job.sourceBox).y < center(job.targetBox).y) || targetIndex < 0;
    const sourcePool = is(job.source, 'bpmn:Participant');
    const targetPool = is(job.target, 'bpmn:Participant');
    let sourceLeg = this.legOf(job.sourceBox, job.sourceOwn, job.sourcePool, !down, job.source);
    let targetLeg = this.legOf(job.targetBox, job.targetOwn, job.targetPool, down, job.target);
    if (sourcePool && !targetPool) sourceLeg = this.dockLeg(job.sourceBox, targetLeg.x, !down);
    if (targetPool && !sourcePool) targetLeg = this.dockLeg(job.targetBox, sourceLeg.x, down);
    if (sourcePool && targetPool) {
      sourceLeg = this.dockLeg(job.sourceBox, center(job.targetBox).x, !down);
      targetLeg = this.dockLeg(job.targetBox, center(job.sourceBox).x, down);
    }
    const sx = sourceLeg.x, tx = targetLeg.x;
    if (sourceIndex < 0 || targetIndex < 0 || Math.abs(sourceIndex - targetIndex) === 1) return { job, sourceLeg, targetLeg, sx, tx, gaps: [Math.min(sourceIndex, targetIndex) < 0 ? 0 : Math.min(sourceIndex, targetIndex)], outside: false, down };
    return { job, sourceLeg, targetLeg, sx, tx, gaps: [sourceIndex < targetIndex ? sourceIndex : sourceIndex - 1, sourceIndex < targetIndex ? targetIndex - 1 : targetIndex], outside: true, down };
  }

  private dockLeg(box: Box, otherX: number, up: boolean): Leg {
    const dockX = this.poolDockX(box, otherX);
    return { points: [{ x: dockX, y: up ? box.y : box.y + box.height }], x: dockX };
  }

  private simplify(points: Point[]): Point[] {
    const out: Point[] = [];
    for (const point of points) {
      const rounded = { x: Math.round(point.x), y: Math.round(point.y) };
      const last = out[out.length - 1];
      if (last && last.x === rounded.x && last.y === rounded.y) continue;
      const prev = out[out.length - 2];
      if (last && prev && ((prev.x === last.x && last.x === rounded.x) || (prev.y === last.y && last.y === rounded.y))) out.pop();
      out.push(rounded);
    }
    return out;
  }
}
