/**
 * Compaction of a kept drawing: empty rows and columns are closed and the
 * frames (expanded sub-processes, lanes, pools) shrink to their content,
 * keeping the order and the relative positions of everything (the `compact`
 * format op and the negative `space` amounts, src/diagram/ops.ts).
 *
 * CONTRACT
 *  emptyStrips(plane, axis, region, opts) finds the empty strips of a region
 *  along an axis: the gaps between what occupies the region (leaf shapes with
 *  their boundary events, expanded sub-processes and, on request, pools as
 *  solid blocks, labels, the borders of groups, waypoints, connection
 *  segments running across the axis and diagonal segments), each with the
 *  room it keeps: the leading strip (from the frame's interior start to the
 *  first content) and the trailing strip (from the last content to the
 *  frame's far border) keep the frame padding, the strips between content
 *  keep the drawing's gap. A region without content is one strip.
 *
 *  compactPlane(plane, opts) closes the empty strips of every frame of the
 *  plane, inside out, each strip with space.ts closeStrip (which checks again
 *  that nothing is in the way), far strips first:
 *   1. expanded sub-processes, deepest first: columns, then rows, with
 *      everything outside the sub-process kept where it is (the sub-process
 *      shrinks; the room it frees is closed by the passes further out)
 *   2. pools: columns, across the whole pool band (all lanes at once, so
 *      lanes keep their relative x positions); on a process plane (no
 *      pools) the columns of the whole plane
 *   3. leaf lanes, bottom to top: rows (parent lanes and the pool shrink
 *      along, the lanes and pools below move up); an empty lane shrinks to
 *      120 px; pools without lanes: rows of the pool; on a process plane
 *      the rows of the whole plane
 *   4. without targets, on a collaboration: the rows between pools, down to
 *      the drawing's pool gap (the smallest one, 20..80 px)
 *   5. pools that were right-aligned before are right-aligned again (at the
 *      rightmost of their new right borders; their lanes follow)
 *  `only` restricts it to the given frames and the frames inside them (a
 *  pool: its columns, its lanes' rows and its sub-processes; a lane: its
 *  leaf lanes' rows and its sub-processes; a sub-process: itself and the
 *  sub-processes inside). Every strip goes through `attempt`, which keeps a
 *  change only when it adds no hard layout defect (see ops.ts); the
 *  result counts the strips closed and the pixels removed per axis.
 *  Paddings: lanes and pools 30 px (left of the content: after the 30 px
 *  headers), sub-processes 30 px (45 px at the top, room for the name).
 *  Interior gaps: the drawing's gap (spacingOf) on x, clamp(row - 80, 30,
 *  60) on y. Strips with less than 10 px to gain are left alone.
 */
import { bottom, right, type Box } from './geom.js';
import { spacingOf } from './place.js';
import { inFrame, isLeaf, type DEdge, type DShape, type Plane } from './plane.js';
import { closeStrip, type Axis, type SpaceResult } from './space.js';

/** padding kept between a frame's border and its content */
export const PAD = 30;
/** padding above the content of a sub-process (its name sits at the top) */
export const SUB_TOP = 45;
/** headers of pools and lanes (their name, written vertically) */
export const HEADER = 30;
/** an empty lane keeps this height */
const EMPTY_LANE = 120;
/** strips with less to gain are left alone */
export const MIN_GAIN = 10;

export interface Strip {
  from: number;
  to: number;
  /** the room the strip keeps */
  keep: number;
}

/** Runs a change of the drawing; keeps it when it made nothing worse, else undoes it (ops.ts). */
export type Attempt = (change: () => SpaceResult | undefined, reroute?: readonly string[]) => boolean;

export interface CompactStats {
  /** strips closed per axis */
  strips: { x: number; y: number };
  /** pixels removed per axis */
  px: { x: number; y: number };
  /** strips that would have made the drawing worse and were left open */
  refused: number;
}

const near = (b: Box, axis: Axis): number => (axis === 'x' ? b.x : b.y);
const far = (b: Box, axis: Axis): number => (axis === 'x' ? right(b) : bottom(b));
/** the extent of a box on the other axis overlaps the region's */
function acrossRegion(b: Box, region: Box, axis: Axis): boolean {
  return axis === 'x' ? b.y < bottom(region) && bottom(b) > region.y : b.x < right(region) && right(b) > region.x;
}

export interface StripOptions {
  /** where the leading strip starts (the frame's interior start); undefined: no leading strip */
  start?: number;
  /** where the trailing strip ends (the frame's far border); undefined: no trailing strip */
  end?: number;
  /** room kept by the leading / trailing strip and between content */
  lead: number;
  trail: number;
  gap: number;
  /** shapes that do not occupy anything (the frame itself and its ancestors) */
  skip: ReadonlySet<string>;
  /** containers that occupy their whole box (default: expanded sub-processes) */
  solid?: (s: DShape) => boolean;
  /** connections that occupy nothing (message flows: they are routed again) */
  loose?: ReadonlySet<string>;
  /** what an empty region keeps (undefined: an empty region is left alone) */
  empty?: number;
}

/** The empty strips of `region` along `axis` (see module contract). */
export function emptyStrips(plane: Plane, axis: Axis, region: Box, opts: StripOptions): Strip[] {
  const merged = occupied(plane, axis, region, opts);
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

/**
 * What occupies `region` along `axis` (see module contract), as merged
 * intervals clipped to the region, near to far.
 */
export function occupied(plane: Plane, axis: Axis, region: Box, opts: Pick<StripOptions, 'skip' | 'solid' | 'loose'>): Array<[number, number]> {
  const occ: Array<[number, number]> = [];
  const lo = near(region, axis);
  const hi = far(region, axis);
  const take = (b: Box, margin = 0): void => {
    if (acrossRegion(b, region, axis) && far(b, axis) + margin >= lo && near(b, axis) - margin <= hi) occ.push([near(b, axis) - margin, far(b, axis) + margin]);
  };
  const solid = opts.solid ?? ((s: DShape): boolean => s.kind === 'subProcess' && s.container);
  for (const s of plane.shapes.values()) {
    if (opts.skip.has(s.id)) continue;
    if (isLeaf(s) || solid(s)) take(s.bounds);
    else if (s.kind === 'group') {
      // a group is a drawn frame: its borders stay where they are
      const [a, b] = [near(s.bounds, axis), far(s.bounds, axis)];
      take(axis === 'x' ? { ...s.bounds, x: a, width: 0 } : { ...s.bounds, y: a, height: 0 }, 2);
      take(axis === 'x' ? { ...s.bounds, x: b, width: 0 } : { ...s.bounds, y: b, height: 0 }, 2);
    }
    if (s.label) take(s.label);
  }
  for (const e of plane.edges.values()) {
    if (opts.loose?.has(e.id)) continue;
    if (e.label) take(e.label);
    for (const p of e.points) take({ x: p.x - 1, y: p.y - 1, width: 2, height: 2 });
    for (let i = 0; i + 1 < e.points.length; i++) {
      const p = e.points[i]!;
      const q = e.points[i + 1]!;
      // a segment running along the axis only gets shorter; one across it (or a diagonal) occupies its extent
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

/** A connection has a bend or its label inside a strip (within the band of `within` on the other axis). */
function touches(e: DEdge, axis: Axis, st: Strip, within: Box | undefined): boolean {
  // boxes grown by 1 px so that a bend (a point) has an extent
  const hit = (b: Box): boolean => far(b, axis) + 1 > st.from && near(b, axis) - 1 < st.to && (!within || acrossRegion({ x: b.x - 1, y: b.y - 1, width: b.width + 2, height: b.height + 2 }, within, axis));
  return [...e.points.slice(1, -1).map((p) => ({ x: p.x, y: p.y, width: 0, height: 0 })), ...(e.label ? [e.label] : [])].some(hit);
}

/**
 * After a strip closed: the bends (and the label) of a connection that lay
 * inside it are scaled into the room the strip kept, so the connection stays
 * orthogonal (closeStrip has already shifted what lay beyond it).
 */
function squeeze(e: DEdge, axis: Axis, st: Strip, within: Box | undefined): void {
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

/** The gaps a closed strip keeps between content: the drawing's gap on x, clamp(row - 80, 30, 60) on y. */
export function drawingGaps(plane: Plane): { x: number; y: number } {
  const sp = spacingOf(plane);
  return { x: sp.gap, y: Math.min(60, Math.max(30, sp.row - 80)) };
}

/** Connections that do not hold a strip open: message flows (their bends and labels are squeezed with the strip). */
export function looseEdges(plane: Plane): Set<string> {
  return new Set([...plane.edges.values()].filter((e) => e.kind === 'messageFlow').map((e) => e.id));
}

/**
 * Closes one empty strip with space.ts closeStrip (which checks that nothing
 * is in the way); message flows do not count, their bends and labels inside
 * the strip are squeezed into the room it keeps.
 */
export function closeEmpty(plane: Plane, axis: Axis, st: Strip, within?: Box, keep?: ReadonlySet<string>): SpaceResult | undefined {
  const loose = looseEdges(plane);
  const touched = [...plane.edges.values()].filter((e) => loose.has(e.id) && touches(e, axis, st, within));
  const r = closeStrip(plane, { axis, from: st.from, to: st.to, gap: st.keep, ignore: loose, ...(within ? { within: { ...within } } : {}), ...(keep ? { keep } : {}) });
  if (r) for (const e of touched) squeeze(e, axis, st, within);
  return r;
}

/** The frame chain of a shape (its frames out to the pool) by id, the shape included. */
function chainIds(plane: Plane, s: DShape): Set<string> {
  const out = new Set<string>([s.id]);
  let cur: DShape | undefined = s;
  for (let i = 0; cur && i < 20; i++) {
    for (const id of [cur.parentId, cur.laneId, cur.poolId]) if (id) out.add(id);
    cur = cur.parentId ? plane.shapes.get(cur.parentId) : cur.laneId ? plane.shapes.get(cur.laneId) : undefined;
  }
  return out;
}

function depth(plane: Plane, s: DShape): number {
  let n = 0;
  for (let p = s.parentId; p && n < 20; p = plane.shapes.get(p)?.parentId) n++;
  return n;
}

export interface CompactOptions {
  /** frames to compact (with the frames inside them); undefined: everything */
  only?: ReadonlySet<string>;
  attempt: Attempt;
}

/** Compacts one plane (see module contract). */
export function compactPlane(plane: Plane, opts: CompactOptions): CompactStats {
  const stats: CompactStats = { strips: { x: 0, y: 0 }, px: { x: 0, y: 0 }, refused: 0 };
  const { x: gapX, y: gapY } = drawingGaps(plane);
  const shapes = (): DShape[] => [...plane.shapes.values()];
  const wanted = (f: DShape): boolean => {
    if (!opts.only) return true;
    if (opts.only.has(f.id)) return true;
    for (const id of opts.only) {
      const target = plane.shapes.get(id);
      if (target && target !== f && inFrame(plane, f, target)) return true;
    }
    return false;
  };
  const pools = shapes().filter((s) => s.kind === 'participant');
  const aligned = pools.length > 1 && pools.every((p) => Math.abs(right(p.bounds) - right(pools[0]!.bounds)) <= 2);
  const findStrips = (axis: Axis, region: Box, o: StripOptions): Strip[] => emptyStrips(plane, axis, region, { ...o, loose: looseEdges(plane) });

  /** closes the strips of one region, far ones first */
  const close = (axis: Axis, strips: Strip[], within: Box | undefined, keep?: ReadonlySet<string>): void => {
    for (const st of [...strips].sort((a, b) => b.from - a.from)) {
      const gain = Math.round(st.to - st.from - st.keep);
      const kept = opts.attempt(() => closeEmpty(plane, axis, st, within, keep));
      if (kept) {
        stats.strips[axis]++;
        stats.px[axis] += gain;
      } else stats.refused++;
    }
  };

  // 1. expanded sub-processes, deepest first; everything outside stays
  const subs = shapes()
    .filter((s) => s.kind === 'subProcess' && s.container && wanted(s))
    .sort((a, b) => depth(plane, b) - depth(plane, a) || b.bounds.x - a.bounds.x);
  for (const sub of subs) {
    for (const axis of ['x', 'y'] as const) {
      const f = plane.shapes.get(sub.id)!;
      const keep = new Set(shapes().filter((s) => s !== f && s.hostId !== f.id && !inFrame(plane, s, f)).map((s) => s.id));
      const b = f.bounds;
      const strips = findStrips(axis, b, {
        start: near(b, axis),
        end: far(b, axis),
        lead: axis === 'x' ? PAD : SUB_TOP,
        trail: PAD,
        gap: axis === 'x' ? gapX : gapY,
        skip: chainIds(plane, f),
      });
      close(axis, strips, b, keep);
    }
  }

  // 2. columns of the pools (all lanes at once), or of a process plane
  const lanesOf = (pool: DShape): DShape[] => shapes().filter((l) => l.kind === 'lane' && l.poolId === pool.id);
  const hasContent = (p: DShape): boolean => shapes().some((s) => isLeaf(s) && s.poolId === p.id);
  for (const pool of pools.filter((p) => !opts.only || opts.only.has(p.id)).sort((a, b) => a.bounds.y - b.bounds.y)) {
    const p = plane.shapes.get(pool.id)!;
    if (!hasContent(p)) continue;
    const lanes = lanesOf(p);
    const start = Math.max(p.bounds.x + HEADER, ...lanes.map((l) => l.bounds.x + HEADER));
    const strips = findStrips('x', p.bounds, { start, end: right(p.bounds), lead: PAD, trail: PAD, gap: gapX, skip: new Set([p.id, ...lanes.map((l) => l.id)]) });
    close('x', strips, p.bounds);
  }
  if (!pools.length && !opts.only) {
    const region = planeBox(plane);
    if (region) close('x', findStrips('x', region, { lead: PAD, trail: PAD, gap: gapX, skip: new Set() }), undefined);
  }

  // 3. rows of the leaf lanes (bottom to top), of pools without lanes, of a process plane
  const leafLanes = shapes()
    .filter((l) => l.kind === 'lane' && !shapes().some((c) => c.kind === 'lane' && c.laneId === l.id) && wanted(l))
    .sort((a, b) => b.bounds.y - a.bounds.y);
  for (const lane of leafLanes) {
    const l = plane.shapes.get(lane.id)!;
    const strips = findStrips('y', l.bounds, { start: l.bounds.y, end: bottom(l.bounds), lead: PAD, trail: PAD, gap: gapY, skip: chainIds(plane, l), empty: EMPTY_LANE });
    // the band of the whole pool: the pool shrinks with its lanes (a band narrower than a frame leaves it alone)
    const pool = l.poolId ? plane.shapes.get(l.poolId) : undefined;
    close('y', strips, pool?.bounds ?? l.bounds);
  }
  for (const pool of pools.filter((p) => wanted(p) && !lanesOf(p).length).sort((a, b) => b.bounds.y - a.bounds.y)) {
    const p = plane.shapes.get(pool.id)!;
    if (!hasContent(p)) continue;
    const strips = findStrips('y', p.bounds, { start: p.bounds.y, end: bottom(p.bounds), lead: PAD, trail: PAD, gap: gapY, skip: new Set([p.id]) });
    close('y', strips, p.bounds);
  }
  if (!pools.length && !opts.only) {
    const region = planeBox(plane);
    if (region) close('y', findStrips('y', region, { lead: PAD, trail: PAD, gap: gapY, skip: new Set() }), undefined);
  }

  // 4. rows between pools
  if (pools.length > 1 && !opts.only) {
    const sorted = [...pools].sort((a, b) => a.bounds.y - b.bounds.y);
    const gaps = sorted.slice(1).map((p, i) => p.bounds.y - bottom(sorted[i]!.bounds)).filter((g) => g >= 0);
    const poolGap = Math.min(80, Math.max(20, gaps.length ? Math.min(...gaps) : 80));
    const region = planeBox(plane, true);
    if (region) close('y', findStrips('y', region, { lead: 0, trail: 0, gap: poolGap, skip: new Set(), solid: (s) => s.kind === 'participant' || (s.kind === 'subProcess' && s.container) }), undefined);
  }

  // 5. pools aligned before stay aligned
  if (aligned) {
    const now = pools.map((p) => plane.shapes.get(p.id)!);
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

/** The box around everything drawn on a plane (pools included). */
function planeBox(plane: Plane, withPools = false): Box | undefined {
  let lo = { x: Infinity, y: Infinity };
  let hi = { x: -Infinity, y: -Infinity };
  for (const s of plane.shapes.values()) {
    if (!withPools && s.kind === 'participant') continue;
    lo = { x: Math.min(lo.x, s.bounds.x), y: Math.min(lo.y, s.bounds.y) };
    hi = { x: Math.max(hi.x, right(s.bounds)), y: Math.max(hi.y, bottom(s.bounds)) };
  }
  if (!Number.isFinite(lo.x)) return undefined;
  return { x: lo.x, y: lo.y, width: hi.x - lo.x, height: hi.y - lo.y };
}
