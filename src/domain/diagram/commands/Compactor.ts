import { bottom, type Box, cx, cy, right } from '../utils/geom.js';
import { Frames } from '../di/Frames.js';
import { PlaneQuery } from '../di/PlaneQuery.js';
import { raw } from '../utils/raw.js';
import type { DEdge, DShape, Plane } from '../di/types.js';
import type { SpaceResult } from '../layout/incremental/SpaceTool.js';
import type { Axis } from '../utils/bands.js';
import { titleDepth } from '../utils/text.js';
import { Drawing } from '../layout/incremental/Drawing.js';

export const PAD = 30;
/** room for the name at the top of a sub-process */
const SUB_TOP = 45;
const HEADER = 30;
const EMPTY_LANE = 120;
const MIN_GAIN = 10;

export interface Strip {
  from: number;
  to: number;
  keep: number;
}

/** Runs a change of the drawing; keeps it when it made nothing worse, else undoes it. */
export type Attempt = (change: () => SpaceResult | undefined, reroute?: readonly string[]) => boolean;

export interface CompactStats {
  strips: { x: number; y: number };
  px: { x: number; y: number };
  refused: number;
}

export interface StripOptions {
  /** undefined: no leading strip */
  start?: number;
  /** undefined: no trailing strip */
  end?: number;
  lead: number;
  trail: number;
  gap: number;
  /** the frame itself and its ancestors occupy nothing */
  skip: ReadonlySet<string>;
  /** containers that occupy their whole box (default: expanded sub-processes) */
  solid?: (shape: DShape) => boolean;
  /** message flows hold no strip open: they are routed again */
  loose?: ReadonlySet<string>;
  /** undefined: an empty region is left alone */
  empty?: number;
}

export interface CompactOptions {
  /** frames to compact, with the frames inside them; undefined: everything */
  only?: ReadonlySet<string>;
  attempt: Attempt;
}

/**
 * Compacts a kept drawing: closes empty rows and columns, inside out (sub-processes, pool
 * columns, lane rows, gaps between pools), so frames shrink to their content while order
 * and relative positions stay. Every strip goes through `attempt`, which keeps only harmless ones.
 */
export class Compactor {
  private readonly plane: Plane;

  constructor(private readonly drawing: Drawing) {
    this.plane = drawing.plane;
  }

  private subTop(sub: DShape): number {
    return Math.max(SUB_TOP, Math.round(titleDepth(raw<string>(sub.el, 'name'), sub.bounds.width) + 4));
  }

  private near(box: Box, axis: Axis): number {
    return axis === 'x' ? box.x : box.y;
  }

  private far(box: Box, axis: Axis): number {
    return axis === 'x' ? right(box) : bottom(box);
  }

  private acrossRegion(box: Box, region: Box, axis: Axis): boolean {
    return axis === 'x' ? box.y < bottom(region) && bottom(box) > region.y : box.x < right(region) && right(box) > region.x;
  }

  /** Leading and trailing strips keep the frame padding, strips between content the gap. */
  private emptyStrips(axis: Axis, region: Box, opts: StripOptions): Strip[] {
    const merged = this.occupied(axis, region, opts);
    const out: Strip[] = [];
    if (!merged.length) {
      if (opts.empty !== undefined && opts.start !== undefined && opts.end !== undefined) out.push({ from: opts.start, to: opts.end, keep: opts.empty });
      return out.filter((strip) => strip.to - strip.from - strip.keep >= MIN_GAIN);
    }
    if (opts.start !== undefined) out.push({ from: opts.start, to: merged[0]![0], keep: opts.lead });
    for (let index = 0; index + 1 < merged.length; index++) out.push({ from: merged[index]![1], to: merged[index + 1]![0], keep: opts.gap });
    if (opts.end !== undefined) out.push({ from: merged[merged.length - 1]![1], to: opts.end, keep: opts.trail });
    return out.filter((strip) => strip.to - strip.from - strip.keep >= MIN_GAIN);
  }

  /**
   * Merged intervals clipped to the region, near to far.
   * A group is a drawn frame: only its borders occupy. An edge segment along the axis only gets
   * shorter; one across it occupies its extent.
   */
  occupied(axis: Axis, region: Box, opts: Pick<StripOptions, 'skip' | 'solid' | 'loose'>): Array<[number, number]> {
    const occ: Array<[number, number]> = [];
    const lo = this.near(region, axis);
    const hi = this.far(region, axis);
    const take = (box: Box, margin = 0): void => {
      if (this.acrossRegion(box, region, axis) && this.far(box, axis) + margin >= lo && this.near(box, axis) - margin <= hi) occ.push([this.near(box, axis) - margin, this.far(box, axis) + margin]);
    };
    const solid = opts.solid ?? ((shape: DShape): boolean => shape.kind === 'subProcess' && shape.container);
    for (const shape of this.plane.shapes.values()) {
      if (opts.skip.has(shape.id)) continue;
      if (PlaneQuery.isLeaf(shape) || solid(shape)) take(shape.bounds);
      else if (shape.kind === 'group') {
        const [nearEdge, farEdge] = [this.near(shape.bounds, axis), this.far(shape.bounds, axis)];
        take(axis === 'x' ? { ...shape.bounds, x: nearEdge, width: 0 } : { ...shape.bounds, y: nearEdge, height: 0 }, 2);
        take(axis === 'x' ? { ...shape.bounds, x: farEdge, width: 0 } : { ...shape.bounds, y: farEdge, height: 0 }, 2);
      }
      if (shape.label) take(shape.label);
    }
    for (const edge of this.plane.edges.values()) {
      if (opts.loose?.has(edge.id)) continue;
      if (edge.label) take(edge.label);
      for (const point of edge.points) take({ x: point.x - 1, y: point.y - 1, width: 2, height: 2 });
      for (let index = 0; index + 1 < edge.points.length; index++) {
        const from = edge.points[index]!;
        const to = edge.points[index + 1]!;
        if (axis === 'x' ? from.y === to.y : from.x === to.x) continue;
        take({ x: Math.min(from.x, to.x), y: Math.min(from.y, to.y), width: Math.abs(to.x - from.x), height: Math.abs(to.y - from.y) }, 1);
      }
    }
    const merged: Array<[number, number]> = [];
    for (const [start, end] of occ.map(([start, end]) => [Math.max(start, lo), Math.min(end, hi)] as [number, number]).filter(([start, end]) => end >= start).sort((one, other) => one[0] - other[0])) {
      const last = merged[merged.length - 1];
      if (last && start <= last[1]) last[1] = Math.max(last[1], end);
      else merged.push([start, end]);
    }
    return merged;
  }

  /**
   * Whether a bend or the label of `edge` lies in the strip; boxes grow by 1 px so that a bend has
   * an extent.
   */
  private touches(edge: DEdge, axis: Axis, strip: Strip, within: Box | undefined): boolean {
    const hit = (box: Box): boolean => this.far(box, axis) + 1 > strip.from && this.near(box, axis) - 1 < strip.to && (!within || this.acrossRegion({ x: box.x - 1, y: box.y - 1, width: box.width + 2, height: box.height + 2 }, within, axis));
    return [...edge.points.slice(1, -1).map((point) => ({ x: point.x, y: point.y, width: 0, height: 0 })), ...(edge.label ? [edge.label] : [])].some(hit);
  }

  /**
   * Scales the bends and label inside a closed strip into the room it kept, so the line
   * stays orthogonal; closeStrip has already shifted what lay beyond. Its line lies 3 before
   * the strip's end: bends from there on started beyond it and have moved already.
   */
  private squeeze(edge: DEdge, axis: Axis, strip: Strip, within: Box | undefined): void {
    const line = strip.to - 3;
    const map = (coordinate: number): number => strip.from + ((coordinate - strip.from) * strip.keep) / (strip.to - strip.from);
    const inBand = (coordinate: number): boolean => !within || (axis === 'x' ? coordinate >= within.y - 1 && coordinate <= bottom(within) + 1 : coordinate >= within.x - 1 && coordinate <= right(within) + 1);
    for (const point of edge.points.slice(1, -1)) {
      const coordinate = axis === 'x' ? point.x : point.y;
      if (coordinate <= strip.from || coordinate >= line || !inBand(axis === 'x' ? point.y : point.x)) continue;
      if (axis === 'x') point.x = Math.round(map(coordinate));
      else point.y = Math.round(map(coordinate));
    }
    const label = edge.label;
    if (!label) return;
    const center = axis === 'x' ? cx(label) : cy(label);
    if (center <= strip.from || center >= line || !inBand(axis === 'x' ? cy(label) : cx(label))) return;
    const offset = Math.round(map(center) - center);
    if (axis === 'x') label.x += offset;
    else label.y += offset;
  }

  gaps(): { x: number; y: number } {
    const spacing = PlaneQuery.spacingOf(this.plane);
    return { x: spacing.gap, y: Math.min(60, Math.max(30, spacing.row - 80)) };
  }

  looseEdges(): Set<string> {
    return new Set([...this.plane.edges.values()].filter((edge) => edge.kind === 'messageFlow').map((edge) => edge.id));
  }

  /** Message flows do not hold the strip open; their bends inside it are squeezed instead. */
  closeEmpty(axis: Axis, strip: Strip, within?: Box, keep?: ReadonlySet<string>): SpaceResult | undefined {
    const loose = this.looseEdges();
    const touched = [...this.plane.edges.values()].filter((edge) => loose.has(edge.id) && this.touches(edge, axis, strip, within));
    const result = this.drawing.closeStrip({ axis, from: strip.from, to: strip.to, gap: strip.keep, ignore: loose, ...(within ? { within: { ...within } } : {}), ...(keep ? { keep } : {}) });
    if (result) for (const edge of touched) this.squeeze(edge, axis, strip, within);
    return result;
  }

  private chainIds(shape: DShape): Set<string> {
    const out = new Set<string>([shape.id]);
    let cur: DShape | undefined = shape;
    for (let depth = 0; cur && depth < 20; depth++) {
      for (const id of [cur.parentId, cur.laneId, cur.poolId]) if (id) out.add(id);
      cur = cur.parentId ? this.plane.shapes.get(cur.parentId) : cur.laneId ? this.plane.shapes.get(cur.laneId) : undefined;
    }
    return out;
  }

  private depth(shape: DShape): number {
    let depth = 0;
    for (let parentId = shape.parentId; parentId && depth < 20; parentId = this.plane.shapes.get(parentId)?.parentId) depth++;
    return depth;
  }

  /**
   * Closes in this order: expanded sub-processes, deepest first, with everything outside staying;
   * columns of the pools (all lanes at once) or of a process plane; rows of the leaf lanes (bottom
   * to top, in the band of the whole pool so the pool shrinks with its lanes), of pools without
   * lanes and of a process plane; rows between pools. Pools aligned before stay aligned.
   */
  compact(opts: CompactOptions): CompactStats {
    const stats: CompactStats = { strips: { x: 0, y: 0 }, px: { x: 0, y: 0 }, refused: 0 };
    const { x: gapX, y: gapY } = this.gaps();
    const shapes = (): DShape[] => [...this.plane.shapes.values()];
    const wanted = (frame: DShape): boolean => {
      if (!opts.only) return true;
      if (opts.only.has(frame.id)) return true;
      for (const id of opts.only) {
        const target = this.plane.shapes.get(id);
        if (target && target !== frame && Frames.within(this.plane, frame, target)) return true;
      }
      return false;
    };
    const pools = shapes().filter((shape) => shape.kind === 'participant');
    const aligned = pools.length > 1 && pools.every((pool) => Math.abs(right(pool.bounds) - right(pools[0]!.bounds)) <= 2);
    const findStrips = (axis: Axis, region: Box, options: StripOptions): Strip[] => this.emptyStrips(axis, region, { ...options, loose: this.looseEdges() });

    const close = (axis: Axis, strips: Strip[], within: Box | undefined, keep?: ReadonlySet<string>): void => {
      for (const strip of [...strips].sort((one, other) => other.from - one.from)) {
        const gain = Math.round(strip.to - strip.from - strip.keep);
        const kept = opts.attempt(() => this.closeEmpty(axis, strip, within, keep));
        if (kept) {
          stats.strips[axis]++;
          stats.px[axis] += gain;
        } else stats.refused++;
      }
    };

    const subs = shapes()
      .filter((shape) => shape.kind === 'subProcess' && shape.container && wanted(shape))
      .sort((one, other) => this.depth(other) - this.depth(one) || other.bounds.x - one.bounds.x);
    for (const sub of subs) {
      for (const axis of ['x', 'y'] as const) {
        const frame = this.plane.shapes.get(sub.id)!;
        const keep = new Set(shapes().filter((shape) => shape !== frame && shape.hostId !== frame.id && !Frames.within(this.plane, shape, frame)).map((shape) => shape.id));
        const box = frame.bounds;
        const strips = findStrips(axis, box, {
          start: this.near(box, axis),
          end: this.far(box, axis),
          lead: axis === 'x' ? PAD : this.subTop(frame),
          trail: PAD,
          gap: axis === 'x' ? gapX : gapY,
          skip: this.chainIds(frame),
        });
        close(axis, strips, box, keep);
      }
    }

    const lanesOf = (pool: DShape): DShape[] => shapes().filter((lane) => lane.kind === 'lane' && lane.poolId === pool.id);
    const hasContent = (pool: DShape): boolean => shapes().some((shape) => PlaneQuery.isLeaf(shape) && shape.poolId === pool.id);
    for (const pool of pools.filter((candidate) => !opts.only || opts.only.has(candidate.id)).sort((one, other) => one.bounds.y - other.bounds.y)) {
      const drawnPool = this.plane.shapes.get(pool.id)!;
      if (!hasContent(drawnPool)) continue;
      const lanes = lanesOf(drawnPool);
      const start = Math.max(drawnPool.bounds.x + HEADER, ...lanes.map((lane) => lane.bounds.x + HEADER));
      const strips = findStrips('x', drawnPool.bounds, { start, end: right(drawnPool.bounds), lead: PAD, trail: PAD, gap: gapX, skip: new Set([drawnPool.id, ...lanes.map((lane) => lane.id)]) });
      close('x', strips, drawnPool.bounds);
    }
    if (!pools.length && !opts.only) {
      const region = this.planeBox();
      if (region) close('x', findStrips('x', region, { lead: PAD, trail: PAD, gap: gapX, skip: new Set() }), undefined);
    }

    const leafLanes = shapes()
      .filter((lane) => lane.kind === 'lane' && !shapes().some((child) => child.kind === 'lane' && child.laneId === lane.id) && wanted(lane))
      .sort((one, other) => other.bounds.y - one.bounds.y);
    for (const lane of leafLanes) {
      const drawnLane = this.plane.shapes.get(lane.id)!;
      const strips = findStrips('y', drawnLane.bounds, { start: drawnLane.bounds.y, end: bottom(drawnLane.bounds), lead: PAD, trail: PAD, gap: gapY, skip: this.chainIds(drawnLane), empty: EMPTY_LANE });
      const pool = drawnLane.poolId ? this.plane.shapes.get(drawnLane.poolId) : undefined;
      close('y', strips, pool?.bounds ?? drawnLane.bounds);
    }
    for (const pool of pools.filter((candidate) => wanted(candidate) && !lanesOf(candidate).length).sort((one, other) => other.bounds.y - one.bounds.y)) {
      const drawnPool = this.plane.shapes.get(pool.id)!;
      if (!hasContent(drawnPool)) continue;
      const strips = findStrips('y', drawnPool.bounds, { start: drawnPool.bounds.y, end: bottom(drawnPool.bounds), lead: PAD, trail: PAD, gap: gapY, skip: new Set([drawnPool.id]) });
      close('y', strips, drawnPool.bounds);
    }
    if (!pools.length && !opts.only) {
      const region = this.planeBox();
      if (region) close('y', findStrips('y', region, { lead: PAD, trail: PAD, gap: gapY, skip: new Set() }), undefined);
    }

    if (pools.length > 1 && !opts.only) {
      const sorted = [...pools].sort((one, other) => one.bounds.y - other.bounds.y);
      const gaps = sorted.slice(1).map((pool, index) => pool.bounds.y - bottom(sorted[index]!.bounds)).filter((gap) => gap >= 0);
      const poolGap = Math.min(80, Math.max(20, gaps.length ? Math.min(...gaps) : 80));
      const region = this.planeBox(true);
      if (region) close('y', findStrips('y', region, { lead: 0, trail: 0, gap: poolGap, skip: new Set(), solid: (shape) => shape.kind === 'participant' || (shape.kind === 'subProcess' && shape.container) }), undefined);
    }

    if (aligned) {
      const now = pools.map((pool) => this.plane.shapes.get(pool.id)!);
      const edge = Math.max(...now.map((pool) => right(pool.bounds)));
      for (const pool of now) {
        const old = right(pool.bounds);
        if (Math.abs(old - edge) <= 0.5) continue;
        pool.bounds.width = edge - pool.bounds.x;
        for (const lane of lanesOf(pool)) if (Math.abs(right(lane.bounds) - old) <= 2) lane.bounds.width = edge - lane.bounds.x;
      }
    }
    return stats;
  }

  private planeBox(withPools = false): Box | undefined {
    let lo = { x: Infinity, y: Infinity };
    let hi = { x: -Infinity, y: -Infinity };
    for (const shape of this.plane.shapes.values()) {
      if (!withPools && shape.kind === 'participant') continue;
      lo = { x: Math.min(lo.x, shape.bounds.x), y: Math.min(lo.y, shape.bounds.y) };
      hi = { x: Math.max(hi.x, right(shape.bounds)), y: Math.max(hi.y, bottom(shape.bounds)) };
    }
    if (!Number.isFinite(lo.x)) return undefined;
    return { x: lo.x, y: lo.y, width: hi.x - lo.x, height: hi.y - lo.y };
  }
}
