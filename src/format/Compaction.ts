import { bottom, right, type Box } from '../diagram/utils/geom.js';
import { Frames } from '../diagram/Frames.js';
import { PlaneQuery } from '../diagram/PlaneQuery.js';
import { raw } from '../diagram/utils/raw.js';
import type { DEdge, DShape, Plane } from '../diagram/types.js';
import type { Axis, SpaceResult } from '../diagram/SpaceTool.js';
import { titleDepth } from '../diagram/utils/text.js';
import { Drawing } from '../diagram/Drawing.js';

export const PAD = 30;
/** room for the name at the top of a sub-process */
export const SUB_TOP = 45;
export const HEADER = 30;
const EMPTY_LANE = 120;
export const MIN_GAIN = 10;

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
  solid?: (s: DShape) => boolean;
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
export class Compaction {
  private readonly plane: Plane;

  constructor(private readonly drawing: Drawing) {
    this.plane = drawing.plane;
  }

  private subTop(sub: DShape): number {
    return Math.max(SUB_TOP, Math.round(titleDepth(raw<string>(sub.el, 'name'), sub.bounds.width) + 4));
  }

  private near(b: Box, axis: Axis): number {
    return axis === 'x' ? b.x : b.y;
  }

  private far(b: Box, axis: Axis): number {
    return axis === 'x' ? right(b) : bottom(b);
  }

  private acrossRegion(b: Box, region: Box, axis: Axis): boolean {
    return axis === 'x' ? b.y < bottom(region) && bottom(b) > region.y : b.x < right(region) && right(b) > region.x;
  }

  /** Leading and trailing strips keep the frame padding, strips between content the gap. */
  private emptyStrips(axis: Axis, region: Box, opts: StripOptions): Strip[] {
    const merged = this.occupied(axis, region, opts);
    const out: Strip[] = [];
    if (!merged.length) {
      if (opts.empty !== undefined && opts.start !== undefined && opts.end !== undefined) out.push({ from: opts.start, to: opts.end, keep: opts.empty });
      return out.filter((s) => s.to - s.from - s.keep >= MIN_GAIN);
    }
    if (opts.start !== undefined) out.push({ from: opts.start, to: merged[0]![0], keep: opts.lead });
    for (let i = 0; i + 1 < merged.length; i++) out.push({ from: merged[i]![1], to: merged[i + 1]![0], keep: opts.gap });
    if (opts.end !== undefined) out.push({ from: merged[merged.length - 1]![1], to: opts.end, keep: opts.trail });
    return out.filter((s) => s.to - s.from - s.keep >= MIN_GAIN);
  }

  /** Merged intervals clipped to the region, near to far. */
  occupied(axis: Axis, region: Box, opts: Pick<StripOptions, 'skip' | 'solid' | 'loose'>): Array<[number, number]> {
    const occ: Array<[number, number]> = [];
    const lo = this.near(region, axis);
    const hi = this.far(region, axis);
    const take = (b: Box, margin = 0): void => {
      if (this.acrossRegion(b, region, axis) && this.far(b, axis) + margin >= lo && this.near(b, axis) - margin <= hi) occ.push([this.near(b, axis) - margin, this.far(b, axis) + margin]);
    };
    const solid = opts.solid ?? ((s: DShape): boolean => s.kind === 'subProcess' && s.container);
    for (const s of this.plane.shapes.values()) {
      if (opts.skip.has(s.id)) continue;
      if (PlaneQuery.isLeaf(s) || solid(s)) take(s.bounds);
      else if (s.kind === 'group') {
        // a group is a drawn frame: its borders stay where they are
        const [a, b] = [this.near(s.bounds, axis), this.far(s.bounds, axis)];
        take(axis === 'x' ? { ...s.bounds, x: a, width: 0 } : { ...s.bounds, y: a, height: 0 }, 2);
        take(axis === 'x' ? { ...s.bounds, x: b, width: 0 } : { ...s.bounds, y: b, height: 0 }, 2);
      }
      if (s.label) take(s.label);
    }
    for (const e of this.plane.edges.values()) {
      if (opts.loose?.has(e.id)) continue;
      if (e.label) take(e.label);
      for (const p of e.points) take({ x: p.x - 1, y: p.y - 1, width: 2, height: 2 });
      for (let i = 0; i + 1 < e.points.length; i++) {
        const p = e.points[i]!;
        const q = e.points[i + 1]!;
        // a segment along the axis only gets shorter; one across it occupies its extent
        if (axis === 'x' ? p.y === q.y : p.x === q.x) continue;
        take({ x: Math.min(p.x, q.x), y: Math.min(p.y, q.y), width: Math.abs(q.x - p.x), height: Math.abs(q.y - p.y) }, 1);
      }
    }
    const merged: Array<[number, number]> = [];
    for (const [a, b] of occ.map(([a, b]) => [Math.max(a, lo), Math.min(b, hi)] as [number, number]).filter(([a, b]) => b >= a).sort((p, q) => p[0] - q[0])) {
      const last = merged[merged.length - 1];
      if (last && a <= last[1]) last[1] = Math.max(last[1], b);
      else merged.push([a, b]);
    }
    return merged;
  }

  private touches(e: DEdge, axis: Axis, st: Strip, within: Box | undefined): boolean {
    // boxes grown by 1 px so that a bend (a point) has an extent
    const hit = (b: Box): boolean => this.far(b, axis) + 1 > st.from && this.near(b, axis) - 1 < st.to && (!within || this.acrossRegion({ x: b.x - 1, y: b.y - 1, width: b.width + 2, height: b.height + 2 }, within, axis));
    return [...e.points.slice(1, -1).map((p) => ({ x: p.x, y: p.y, width: 0, height: 0 })), ...(e.label ? [e.label] : [])].some(hit);
  }

  /**
   * Scales the bends and label inside a closed strip into the room it kept, so the line
   * stays orthogonal; closeStrip has already shifted what lay beyond.
   */
  private squeeze(e: DEdge, axis: Axis, st: Strip, within: Box | undefined): void {
    const line = st.to - 3; // closeStrip's line: what started beyond it moved
    const map = (v: number): number => st.from + ((v - st.from) * st.keep) / (st.to - st.from);
    const inBand = (v: number): boolean => !within || (axis === 'x' ? v >= within.y - 1 && v <= bottom(within) + 1 : v >= within.x - 1 && v <= right(within) + 1);
    for (const p of e.points.slice(1, -1)) {
      const v = axis === 'x' ? p.x : p.y;
      if (v <= st.from || v >= line || !inBand(axis === 'x' ? p.y : p.x)) continue;
      if (axis === 'x') p.x = Math.round(map(v));
      else p.y = Math.round(map(v));
    }
    const l = e.label;
    if (!l) return;
    const c = axis === 'x' ? l.x + l.width / 2 : l.y + l.height / 2;
    if (c <= st.from || c >= line || !inBand(axis === 'x' ? l.y + l.height / 2 : l.x + l.width / 2)) return;
    const d = Math.round(map(c) - c);
    if (axis === 'x') l.x += d;
    else l.y += d;
  }

  gaps(): { x: number; y: number } {
    const sp = PlaneQuery.spacingOf(this.plane);
    return { x: sp.gap, y: Math.min(60, Math.max(30, sp.row - 80)) };
  }

  looseEdges(): Set<string> {
    return new Set([...this.plane.edges.values()].filter((e) => e.kind === 'messageFlow').map((e) => e.id));
  }

  /** Message flows do not hold the strip open; their bends inside it are squeezed instead. */
  closeEmpty(axis: Axis, st: Strip, within?: Box, keep?: ReadonlySet<string>): SpaceResult | undefined {
    const loose = this.looseEdges();
    const touched = [...this.plane.edges.values()].filter((e) => loose.has(e.id) && this.touches(e, axis, st, within));
    const r = this.drawing.closeStrip({ axis, from: st.from, to: st.to, gap: st.keep, ignore: loose, ...(within ? { within: { ...within } } : {}), ...(keep ? { keep } : {}) });
    if (r) for (const e of touched) this.squeeze(e, axis, st, within);
    return r;
  }

  private chainIds(s: DShape): Set<string> {
    const out = new Set<string>([s.id]);
    let cur: DShape | undefined = s;
    for (let i = 0; cur && i < 20; i++) {
      for (const id of [cur.parentId, cur.laneId, cur.poolId]) if (id) out.add(id);
      cur = cur.parentId ? this.plane.shapes.get(cur.parentId) : cur.laneId ? this.plane.shapes.get(cur.laneId) : undefined;
    }
    return out;
  }

  private depth(s: DShape): number {
    let n = 0;
    for (let p = s.parentId; p && n < 20; p = this.plane.shapes.get(p)?.parentId) n++;
    return n;
  }

  compact(opts: CompactOptions): CompactStats {
    const stats: CompactStats = { strips: { x: 0, y: 0 }, px: { x: 0, y: 0 }, refused: 0 };
    const { x: gapX, y: gapY } = this.gaps();
    const shapes = (): DShape[] => [...this.plane.shapes.values()];
    const wanted = (f: DShape): boolean => {
      if (!opts.only) return true;
      if (opts.only.has(f.id)) return true;
      for (const id of opts.only) {
        const target = this.plane.shapes.get(id);
        if (target && target !== f && Frames.within(this.plane, f, target)) return true;
      }
      return false;
    };
    const pools = shapes().filter((s) => s.kind === 'participant');
    const aligned = pools.length > 1 && pools.every((p) => Math.abs(right(p.bounds) - right(pools[0]!.bounds)) <= 2);
    const findStrips = (axis: Axis, region: Box, o: StripOptions): Strip[] => this.emptyStrips(axis, region, { ...o, loose: this.looseEdges() });

    const close = (axis: Axis, strips: Strip[], within: Box | undefined, keep?: ReadonlySet<string>): void => {
      for (const st of [...strips].sort((a, b) => b.from - a.from)) {
        const gain = Math.round(st.to - st.from - st.keep);
        const kept = opts.attempt(() => this.closeEmpty(axis, st, within, keep));
        if (kept) {
          stats.strips[axis]++;
          stats.px[axis] += gain;
        } else stats.refused++;
      }
    };

    // 1. expanded sub-processes, deepest first; everything outside stays
    const subs = shapes()
      .filter((s) => s.kind === 'subProcess' && s.container && wanted(s))
      .sort((a, b) => this.depth(b) - this.depth(a) || b.bounds.x - a.bounds.x);
    for (const sub of subs) {
      for (const axis of ['x', 'y'] as const) {
        const f = this.plane.shapes.get(sub.id)!;
        const keep = new Set(shapes().filter((s) => s !== f && s.hostId !== f.id && !Frames.within(this.plane, s, f)).map((s) => s.id));
        const b = f.bounds;
        const strips = findStrips(axis, b, {
          start: this.near(b, axis),
          end: this.far(b, axis),
          lead: axis === 'x' ? PAD : this.subTop(f),
          trail: PAD,
          gap: axis === 'x' ? gapX : gapY,
          skip: this.chainIds(f),
        });
        close(axis, strips, b, keep);
      }
    }

    // 2. columns of the pools (all lanes at once), or of a process plane
    const lanesOf = (pool: DShape): DShape[] => shapes().filter((l) => l.kind === 'lane' && l.poolId === pool.id);
    const hasContent = (p: DShape): boolean => shapes().some((s) => PlaneQuery.isLeaf(s) && s.poolId === p.id);
    for (const pool of pools.filter((p) => !opts.only || opts.only.has(p.id)).sort((a, b) => a.bounds.y - b.bounds.y)) {
      const p = this.plane.shapes.get(pool.id)!;
      if (!hasContent(p)) continue;
      const lanes = lanesOf(p);
      const start = Math.max(p.bounds.x + HEADER, ...lanes.map((l) => l.bounds.x + HEADER));
      const strips = findStrips('x', p.bounds, { start, end: right(p.bounds), lead: PAD, trail: PAD, gap: gapX, skip: new Set([p.id, ...lanes.map((l) => l.id)]) });
      close('x', strips, p.bounds);
    }
    if (!pools.length && !opts.only) {
      const region = this.planeBox();
      if (region) close('x', findStrips('x', region, { lead: PAD, trail: PAD, gap: gapX, skip: new Set() }), undefined);
    }

    // 3. rows of the leaf lanes (bottom to top), of pools without lanes, of a process plane
    const leafLanes = shapes()
      .filter((l) => l.kind === 'lane' && !shapes().some((c) => c.kind === 'lane' && c.laneId === l.id) && wanted(l))
      .sort((a, b) => b.bounds.y - a.bounds.y);
    for (const lane of leafLanes) {
      const l = this.plane.shapes.get(lane.id)!;
      const strips = findStrips('y', l.bounds, { start: l.bounds.y, end: bottom(l.bounds), lead: PAD, trail: PAD, gap: gapY, skip: this.chainIds(l), empty: EMPTY_LANE });
      // the band of the whole pool, so the pool shrinks with its lanes
      const pool = l.poolId ? this.plane.shapes.get(l.poolId) : undefined;
      close('y', strips, pool?.bounds ?? l.bounds);
    }
    for (const pool of pools.filter((p) => wanted(p) && !lanesOf(p).length).sort((a, b) => b.bounds.y - a.bounds.y)) {
      const p = this.plane.shapes.get(pool.id)!;
      if (!hasContent(p)) continue;
      const strips = findStrips('y', p.bounds, { start: p.bounds.y, end: bottom(p.bounds), lead: PAD, trail: PAD, gap: gapY, skip: new Set([p.id]) });
      close('y', strips, p.bounds);
    }
    if (!pools.length && !opts.only) {
      const region = this.planeBox();
      if (region) close('y', findStrips('y', region, { lead: PAD, trail: PAD, gap: gapY, skip: new Set() }), undefined);
    }

    // 4. rows between pools
    if (pools.length > 1 && !opts.only) {
      const sorted = [...pools].sort((a, b) => a.bounds.y - b.bounds.y);
      const gaps = sorted.slice(1).map((p, i) => p.bounds.y - bottom(sorted[i]!.bounds)).filter((g) => g >= 0);
      const poolGap = Math.min(80, Math.max(20, gaps.length ? Math.min(...gaps) : 80));
      const region = this.planeBox(true);
      if (region) close('y', findStrips('y', region, { lead: 0, trail: 0, gap: poolGap, skip: new Set(), solid: (s) => s.kind === 'participant' || (s.kind === 'subProcess' && s.container) }), undefined);
    }

    // 5. pools aligned before stay aligned
    if (aligned) {
      const now = pools.map((p) => this.plane.shapes.get(p.id)!);
      const edge = Math.max(...now.map((p) => right(p.bounds)));
      for (const p of now) {
        const old = right(p.bounds);
        if (Math.abs(old - edge) <= 0.5) continue;
        p.bounds.width = edge - p.bounds.x;
        for (const l of lanesOf(p)) if (Math.abs(right(l.bounds) - old) <= 2) l.bounds.width = edge - l.bounds.x;
      }
    }
    return stats;
  }

  private planeBox(withPools = false): Box | undefined {
    let lo = { x: Infinity, y: Infinity };
    let hi = { x: -Infinity, y: -Infinity };
    for (const s of this.plane.shapes.values()) {
      if (!withPools && s.kind === 'participant') continue;
      lo = { x: Math.min(lo.x, s.bounds.x), y: Math.min(lo.y, s.bounds.y) };
      hi = { x: Math.max(hi.x, right(s.bounds)), y: Math.max(hi.y, bottom(s.bounds)) };
    }
    if (!Number.isFinite(lo.x)) return undefined;
    return { x: lo.x, y: lo.y, width: hi.x - lo.x, height: hi.y - lo.y };
  }
}
