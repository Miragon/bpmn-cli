/**
 * Orthogonal routing of ONE connection (pure geometry: boxes and points in,
 * points out; no moddle, no DI). Used by the incremental engine and the
 * `route` format op to (re)draw a single flow inside a drawing it must keep.
 *
 * Contract of `routeOrthogonal(req)`:
 *  - returns ≥ 2 points; every segment is horizontal or vertical, without
 *    zero-length segments or collinear interior points
 *  - the first point lies on the source border at an allowed exit side, the
 *    last on the target border at an allowed entry side (`sourceSides` /
 *    `targetSides`; default: all four). The port is the middle of the side; it
 *    moves along the side only when the middle is blocked by an obstacle (e.g.
 *    a boundary event) or when that yields a straight line to a box it faces,
 *    and never with `sourceMiddle` / `targetMiddle` (a gateway: the port is a
 *    vertex of the diamond). A port on a side listed in `sourceAvoid` /
 *    `targetAvoid` (taken by other connections of that shape) costs AVOID =
 *    100: such a side is used only when every other one costs more than
 *    that extra (a detour with a further bend and a crossing does)
 *  - `targetMerge` (the target is a join): the common tail of the lines that
 *    end on a top / bottom port of the target (2 px tolerance) with a
 *    vertical last run is shared, not overlapped. A line's tail is its last
 *    run, a short hook before it (a horizontal run of at most the target's
 *    width + 2·stub) with the run before that, and every run back to where
 *    it parts from another such line into the same port (the run on which
 *    they part included; metrics.ts joinTail). Running on a tail costs no
 *    overlap when the route follows it into the port, leaving it before the
 *    port costs the overlap, crossing it costs as usual: a further entry
 *    joins the bundle and follows it into the same vertex. The waiver can
 *    make a route that crosses a line on its way to the shared vertex
 *    cheaper than a crossing-free detour to a free one: the caller compares
 *    (reroute.ts routeEdge, with `crossings`)
 *  - a target with `targetMiddle` (a gateway) is touched only at its port:
 *    running through another vertex of the diamond (along its bounding box,
 *    under or beside it) costs like cutting an obstacle (only the target: a
 *    route may still run along the box of a gateway source)
 *  - the first and last segment run ≥ 15 px (≥ `margin`) straight off the
 *    border before the first bend, unless the boxes are too close for that
 *  - never passes through an obstacle, the source or the target when an
 *    obstacle-free route exists (otherwise it still returns the least bad one)
 *  - stays inside `frame`; the frame is left only when no obstacle-free route
 *    exists inside it
 *  - minimises  length + 150·bend + 200·crossing of `lines`
 *               + 200 more for a crossing within 25 px of the start or end
 *                 of one of `lines` (next to its arrowhead or its shape)
 *               + 300·collinear overlap with `lines` (but not with a tail
 *                 `targetMerge` shares, followed into its port)
 *    + 300 per grid edge running along an obstacle's outline (on its border),
 *    plus small tie-breakers: running inside an obstacle's margin costs 1 per
 *    px, an off-centre port a few px, and later entries of `sourceSides` /
 *    `targetSides` a few px (the order of the sides is the preference on ties)
 *  - deterministic, and independent of the order of `obstacles` and `lines`
 *
 * Algorithm: an orthogonal visibility (Hanan) grid from the obstacle borders ±
 * margin, the source/target stub lines, the ports and the midlines between
 * source and target; A* over (grid node, direction, overlap run or shared
 * tail) states with the cost above (an edge inside an obstacle or through
 * another vertex of a gateway target costs 1e6 instead of being removed, so
 * a route always exists). Turning within the stub distance of the
 * source or target costs 500. Only obstacles near the connection enter the grid
 * (the region grows twice from the padded bounding box of source and target by
 * the obstacles touching it); if the best route there still cuts an obstacle,
 * the search is repeated over the whole plane. Finally the middle segment of a
 * Z is centred in its free channel when that costs nothing. Typical cost with
 * 200 obstacles: well below 1 ms per route between neighbours; a route across
 * a whole irregular plane takes a few ms up to a few tens of ms.
 *
 * `defaultSides(kind, role)` gives the BPMN conventions: activities and
 * gateways exit right/bottom/top and enter left/bottom/top, boundary events
 * exit bottom (use `attachedSide` for events on another border of their host),
 * pools/lanes (message flows) use top/bottom, everything else any side.
 * `crossings(points, lines)` counts a route's proper crossings with `lines`
 * (the test of the cost).
 */
import type { Box, Point } from '../layout/types.js';

export type Side = 'left' | 'right' | 'top' | 'bottom';

export type ShapeKind =
  | 'task'
  | 'subProcess'
  | 'event'
  | 'gateway'
  | 'boundary'
  | 'data'
  | 'annotation'
  | 'participant'
  | 'lane'
  | 'group'
  | 'other';

export interface RouteRequest {
  source: Box;
  target: Box;
  /** allowed exit sides, most preferred first (default: all four) */
  sourceSides?: Side[];
  /** allowed entry sides, most preferred first (default: all four) */
  targetSides?: Side[];
  /** the ports stay at the middle of their side (a gateway's vertices) */
  sourceMiddle?: boolean;
  targetMiddle?: boolean;
  /** sides other connections of the shape already use: a port there costs AVOID */
  sourceAvoid?: Side[];
  targetAvoid?: Side[];
  /**
   * the target is a join: running on the common tail of the lines that end
   * on a top / bottom port of the target, followed into that port, is no
   * overlap (the entries share that vertex); crossing it still costs
   */
  targetMerge?: boolean;
  /** shapes to avoid (NOT source/target; the caller excludes containers) */
  obstacles: Box[];
  /** existing connections (not the one being routed): crossing one costs, running on top of one costs more */
  lines?: Point[][];
  /** stay inside (pool / sub-process / lane for intra-lane flows) */
  frame?: Box;
  /** clearance to obstacles, default 15 */
  margin?: number;
}

const BEND = 150;
/** a port on a side to avoid (taken by another connection of the shape) */
const AVOID = 100;
const CROSS = 200;
/** a crossing this close to the start / end of a line (its arrowhead, its shape) costs CROSS more */
const END_ZONE = 25;
const OVERLAP = 300;
const HIT = 1_000_000;
const STUB_TURN = 500;
/** extra cost per px of a grid edge inside an obstacle's margin */
const NEAR = 1;
const MIN_STUB = 15;
/** distance under which two parallel segments count as running on top of each other */
const OVERLAP_TOL = 2;
/** cost of a port off the middle of its side: base + slope · offset / side length */
const PORT_OFFSET = 10;
const PORT_SLOPE = 40;
/** tie-break cost of the k-th allowed side */
const SRC_RANK = [0, 2, 5, 9];
const TGT_RANK = [0, 1, 4, 8];
/** the search region: bounding box of source and target plus this padding */
const REGION_PAD = 100;
/** margin of the last-resort search through narrow gaps */
const THIN_MARGIN = 3;
const EPS = 1e-6;

const SOURCE_DEFAULT: Side[] = ['right', 'bottom', 'top', 'left'];
const TARGET_DEFAULT: Side[] = ['left', 'bottom', 'top', 'right'];

/** travel direction 0..3 = right, down, left, up */
const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];
const OUTWARD: Record<Side, number> = { right: 0, bottom: 1, left: 2, top: 3 };

/** BPMN conventions for the sides a connection may leave (`source`) or enter (`target`) a shape. */
export function defaultSides(kind: ShapeKind, role: 'source' | 'target'): Side[] {
  const source = role === 'source';
  switch (kind) {
    case 'task':
    case 'subProcess':
    case 'gateway':
      return source ? ['right', 'bottom', 'top'] : ['left', 'bottom', 'top'];
    case 'boundary':
      return source ? ['bottom'] : [...TARGET_DEFAULT];
    case 'participant':
    case 'lane':
      return source ? ['bottom', 'top'] : ['top', 'bottom'];
    default:
      return source ? [...SOURCE_DEFAULT] : [...TARGET_DEFAULT];
  }
}

/** the border of `host` a boundary event sits on (the side its flows should leave by) */
export function attachedSide(event: Box, host: Box): Side {
  const cx = event.x + event.width / 2;
  const cy = event.y + event.height / 2;
  const dist: Array<[Side, number]> = [
    ['bottom', Math.abs(cy - bottom(host))],
    ['right', Math.abs(cx - right(host))],
    ['top', Math.abs(cy - host.y)],
    ['left', Math.abs(cx - host.x)],
  ];
  return dist.reduce((a, b) => (b[1] < a[1] ? b : a))[0];
}

// ---------------------------------------------------------------- geometry

function right(b: Box): number {
  return b.x + b.width;
}

function bottom(b: Box): number {
  return b.y + b.height;
}

function inflate(b: Box, d: number): Box {
  return { x: b.x - d, y: b.y - d, width: b.width + 2 * d, height: b.height + 2 * d };
}

function union(a: Box, b: Box): Box {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(right(a), right(b)) - x, height: Math.max(bottom(a), bottom(b)) - y };
}

function intersect(a: Box, b: Box): Box {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  return { x, y, width: Math.max(0, Math.min(right(a), right(b)) - x), height: Math.max(0, Math.min(bottom(a), bottom(b)) - y) };
}

/** closed boxes touch or overlap */
function touches(a: Box, b: Box): boolean {
  return a.x <= right(b) && right(a) >= b.x && a.y <= bottom(b) && bottom(a) >= b.y;
}

function sameBox(a: Box, b: Box): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

function finiteBox(b: Box): boolean {
  return [b.x, b.y, b.width, b.height].every(Number.isFinite) && b.width >= 0 && b.height >= 0;
}

/** the segment a-b runs through the open interior of `box` (touching the border does not count) */
function segmentHitsBox(a: Point, b: Point, box: Box): boolean {
  return Math.min(a.x, b.x) < right(box) && Math.max(a.x, b.x) > box.x && Math.min(a.y, b.y) < bottom(box) && Math.max(a.y, b.y) > box.y;
}

function orient(a: Point, b: Point, c: Point): number {
  return Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
}

/** proper crossing (shared endpoints, T-junctions and collinear runs do not count) */
function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b);
  return o1 * o2 < 0 && o3 * o4 < 0;
}

/** two axis-parallel segments run on top of each other for more than 1 px */
function segmentsOverlap(a: Point, b: Point, c: Point, d: Point): boolean {
  if (a.y === b.y && Math.abs(c.y - d.y) < EPS) {
    if (Math.abs(a.y - c.y) > OVERLAP_TOL) return false;
    return Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) - Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) > 1;
  }
  if (a.x === b.x && Math.abs(c.x - d.x) < EPS) {
    if (Math.abs(a.x - c.x) > OVERLAP_TOL) return false;
    return Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) - Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)) > 1;
  }
  return false;
}

/** Proper crossings of a route with `lines` (the test of the cost: shared end points, T-junctions and collinear runs do not count). */
export function crossings(points: readonly Point[], lines: readonly Point[][]): number {
  let n = 0;
  for (let i = 0; i + 1 < points.length; i++) {
    for (const line of lines) for (let k = 0; k + 1 < line.length; k++) if (segmentsCross(points[i]!, points[i + 1]!, line[k]!, line[k + 1]!)) n++;
  }
  return n;
}

/** drop duplicate points and interior points on a straight run */
function simplify(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && last.x === p.x && last.y === p.y) continue;
    const prev = out[out.length - 2];
    if (prev && last && ((prev.x === last.x && last.x === p.x) || (prev.y === last.y && last.y === p.y))) out.pop();
    out.push({ x: p.x, y: p.y });
  }
  // never fewer than two points (the contract): ports on one spot keep both ends
  if (out.length === 1 && points.length > 1) out.push({ ...out[0]! });
  return out;
}

/** first index k with arr[k] > v */
function upper(arr: number[], v: number): number {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid]! > v) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** first index k with arr[k] >= v */
function lower(arr: number[], v: number): number {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid]! >= v) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

// ---------------------------------------------------------------- ports

interface Port {
  x: number;
  y: number;
  side: Side;
  /** tie-break cost (side preference, offset from the middle) */
  cost: number;
}

/** the range a side covers along its own axis (y for left/right, x for top/bottom) */
function span(b: Box, side: Side): [number, number] {
  return side === 'left' || side === 'right' ? [b.y, bottom(b)] : [b.x, right(b)];
}

function pointOn(b: Box, side: Side, t: number): Point {
  switch (side) {
    case 'left':
      return { x: b.x, y: t };
    case 'right':
      return { x: right(b), y: t };
    case 'top':
      return { x: t, y: b.y };
    case 'bottom':
      return { x: t, y: bottom(b) };
  }
}

/** `other` lies entirely beyond `side` of `b` (a straight line from that side can reach it) */
function faces(b: Box, side: Side, other: Box): boolean {
  switch (side) {
    case 'left':
      return right(other) <= b.x;
    case 'right':
      return other.x >= right(b);
    case 'top':
      return bottom(other) <= b.y;
    case 'bottom':
      return other.y >= bottom(b);
  }
}

function stubBlocked(b: Box, side: Side, t: number, stub: number, obstacles: Box[]): boolean {
  const p = pointOn(b, side, t);
  const d = OUTWARD[side];
  const q = { x: p.x + DX[d]! * stub, y: p.y + DY[d]! * stub };
  return obstacles.some((o) => segmentHitsBox(p, q, o));
}

/**
 * Candidate ports of one box: per allowed side the middle, a position aligned
 * with the centre of the other box when this side faces it (straight line),
 * and, when the middle's stub is blocked or another connection already docks
 * there (`docked`: end points of existing lines), positions beside the
 * blockers and at a quarter of the side.
 */
function makePorts(b: Box, sides: Side[], rank: number[], other: Box, obstacles: Box[], m: number, stub: number, docked: Point[] = [], middle = false, avoid: readonly Side[] = []): Port[] {
  const ports: Port[] = [];
  sides.forEach((side, k) => {
    const base = rank[Math.min(k, rank.length - 1)]! + (avoid.includes(side) ? AVOID : 0);
    const [lo, hi] = span(b, side);
    const len = hi - lo;
    const mid = Math.round(lo + len / 2);
    const inset = Math.min(10, len / 4);
    const cands = new Map<number, number>([[mid, base]]);
    const add = (t: number, clamp = false): void => {
      if (middle) return;
      if (clamp) t = Math.round(Math.min(hi - inset, Math.max(lo + inset, t)));
      if (t < lo + inset || t > hi - inset || cands.has(t)) return;
      if (stubBlocked(b, side, t, stub, obstacles)) return;
      cands.set(t, base + PORT_OFFSET + (PORT_SLOPE * Math.abs(t - mid)) / Math.max(len, 1));
    };
    if (faces(b, side, other)) {
      const [olo, ohi] = span(other, side);
      add(Math.round(olo + (ohi - olo) / 2));
    }
    const blockers = obstacles.filter((o) => stubBlocked(b, side, mid, stub, [o]));
    for (const o of blockers) {
      const [olo, ohi] = span(o, side);
      add(olo - m, true);
      add(ohi + m, true);
    }
    const taken = docked.some((p) => {
      const q = pointOn(b, side, mid);
      return Math.abs(p.x - q.x) <= 2 && Math.abs(p.y - q.y) <= 2;
    });
    if (blockers.length || taken) {
      add(Math.round(lo + len / 4));
      add(Math.round(lo + (3 * len) / 4));
    }
    for (const [t, cost] of [...cands].sort((x, y) => x[0] - y[0])) ports.push({ ...pointOn(b, side, t), side, cost });
  });
  return ports;
}

// ---------------------------------------------------------------- context

interface Seg {
  a: Point;
  b: Point;
  kind: 'h' | 'v' | 'd';
  /** the line's start / end when they lie on this segment (its first / last one) */
  ends?: Point[];
  /** part of the shared tail of a line into a top / bottom target port (targetMerge): following it into the port is no overlap */
  merge?: boolean;
}

interface Ctx {
  s: Box;
  t: Box;
  m: number;
  stub: number;
  obstacles: Box[];
  segs: Seg[];
  src: Port[];
  tgt: Port[];
  /** the target is a gateway (`targetMiddle`): touched only at its port */
  tMiddle: boolean;
}

function sidesOf(sides: Side[] | undefined, fallback: Side[]): Side[] {
  const list = (sides ?? []).filter((s, i, all) => all.indexOf(s) === i && s in OUTWARD);
  return list.length ? list : fallback;
}

/** consecutive segments of one line going one way on one grid line (their indices into the segments) */
interface Run {
  a: Point;
  b: Point;
  kind: Seg['kind'];
  segs: number[];
}

/** the runs of the segments from index `first` on (one line) */
function runsOf(segs: Seg[], first: number): Run[] {
  const out: Run[] = [];
  const way = (p: Point, q: Point): string => `${Math.sign(q.x - p.x)},${Math.sign(q.y - p.y)}`;
  for (let k = first; k < segs.length; k++) {
    const { a, b, kind } = segs[k]!;
    const last = out[out.length - 1];
    if (last && kind !== 'd' && kind === last.kind && (kind === 'v' ? Math.abs(a.x - last.a.x) : Math.abs(a.y - last.a.y)) < EPS && way(a, b) === way(last.a, last.b)) {
      last.b = b;
      last.segs.push(k);
    } else out.push({ a, b, kind, segs: [k] });
  }
  return out;
}

/**
 * The segments of `lines`. With `mergeAt` (targetMerge: the target's top /
 * bottom ports), the shared tail of every line that ends on such a port with
 * a vertical last run into it is marked `merge` (see the module contract):
 * its last run, a hook of at most `hook` px with the run before it, and the
 * runs back to where it parts from another such line into the same port.
 */
function lineSegments(lines: Point[][], mergeAt: readonly Port[] = [], hook = 0): Seg[] {
  const segs: Seg[] = [];
  const entries: Array<{ port: Port; runs: Run[] }> = [];
  for (const line of lines) {
    const first = segs.length;
    for (let i = 0; i + 1 < line.length; i++) {
      const a = line[i]!, b = line[i + 1]!;
      if (![a.x, a.y, b.x, b.y].every(Number.isFinite)) continue;
      const dx = Math.abs(a.x - b.x), dy = Math.abs(a.y - b.y);
      if (dx < EPS && dy < EPS) continue;
      const kind = dy < EPS ? 'h' : dx < EPS ? 'v' : 'd';
      const ends = kind === 'd' ? [] : [...(i === 0 ? [a] : []), ...(i + 2 === line.length ? [b] : [])];
      segs.push({ a, b, kind, ...(ends.length ? { ends } : {}) });
    }
    const end = line[line.length - 1];
    const port = end && mergeAt.find((p) => Math.abs(p.x - end.x) <= OVERLAP_TOL && Math.abs(p.y - end.y) <= OVERLAP_TOL);
    if (!port) continue;
    const runs = runsOf(segs, first);
    const last = runs[runs.length - 1];
    // a vertical last run entering the port from outside (up into a bottom vertex, down into a top one)
    if (last?.kind === 'v' && (port.side === 'bottom' ? last.a.y > last.b.y : last.a.y < last.b.y)) entries.push({ port, runs });
  }
  const mark = (r: Run | undefined): void => {
    for (const k of r?.segs ?? []) segs[k]!.merge = true;
  };
  for (const { port, runs } of entries) {
    const n = runs.length;
    mark(runs[n - 1]);
    const h = runs[n - 2];
    if (h?.kind === 'h' && Math.abs(h.a.x - h.b.x) <= hook) {
      mark(h);
      mark(runs[n - 3]);
    }
    // back to where it parts from another entry into the same port
    for (const other of entries) {
      if (other.port !== port || other.runs === runs) continue;
      for (let i = n - 1, j = other.runs.length - 1; i >= 0 && j >= 0; i--, j--) {
        const x = runs[i]!, y = other.runs[j]!;
        if (!segmentsOverlap(x.a, x.b, y.a, y.b)) break;
        mark(x);
        if (Math.abs(x.a.x - y.a.x) > OVERLAP_TOL || Math.abs(x.a.y - y.a.y) > OVERLAP_TOL) break;
      }
    }
  }
  return segs;
}

function context(req: RouteRequest): Ctx {
  const m = Math.max(0, req.margin ?? 15);
  const stub = Math.max(MIN_STUB, m);
  const s = req.source, t = req.target;
  const obstacles = req.obstacles.filter(finiteBox);
  const docked = (req.lines ?? []).flatMap((l) => (l.length >= 2 ? [l[0]!, l[l.length - 1]!] : []));
  const tgt = makePorts(t, sidesOf(req.targetSides, TARGET_DEFAULT), TGT_RANK, s, obstacles, m, stub, docked, req.targetMiddle === true, req.targetAvoid);
  // a join's entries share its top / bottom vertex: the common tail of the lines into such a port is no overlap
  const mergeAt = req.targetMerge ? tgt.filter((p) => p.side === 'top' || p.side === 'bottom') : [];
  return {
    s,
    t,
    m,
    stub,
    obstacles,
    segs: lineSegments(req.lines ?? [], mergeAt, t.width + 2 * stub),
    src: makePorts(s, sidesOf(req.sourceSides, SOURCE_DEFAULT), SRC_RANK, t, obstacles, m, stub, docked, req.sourceMiddle === true, req.sourceAvoid),
    tgt,
    tMiddle: req.targetMiddle === true,
  };
}

// ---------------------------------------------------------------- grid

interface Grid {
  xs: number[];
  ys: number[];
  nx: number;
  ny: number;
  /** static cost of the horizontal edge (i,j)-(i+1,j) at j·(nx-1)+i and the vertical edge (i,j)-(i,j+1) at j·nx+i */
  hCost: Float64Array;
  vCost: Float64Array;
  /** the edge runs on top of an existing line */
  hOv: Uint8Array;
  vOv: Uint8Array;
  anyOv: boolean;
  /** the edge runs on a shared tail into a join's vertex (targetMerge) and on no other line */
  hMg: Uint8Array;
  vMg: Uint8Array;
  anyMg: boolean;
  /** extra cost for turning at a node (stub zones of source and target) */
  turn: Float64Array;
}

/**
 * The search region: source and target plus padding, grown twice by the
 * obstacles touching it (so routes can go around them), clipped to the frame.
 * Every obstacle touching the region takes part in the search; a route that
 * would need more room is found by the whole-plane retry.
 */
function region(c: Ctx, wide: boolean, frame: Box | undefined): Box {
  const grow = 2 * c.m + 10;
  const clip = (b: Box): Box => (frame ? intersect(b, frame) : b);
  let ext = inflate(union(c.s, c.t), Math.max(REGION_PAD, 2 * c.stub + 20));
  if (wide) for (const o of c.obstacles) ext = union(ext, inflate(o, grow));
  ext = clip(ext);
  for (let round = 0; round < 2; round++) {
    let next = ext;
    for (const o of c.obstacles) if (touches(o, ext)) next = union(next, inflate(o, grow));
    next = clip(next);
    if (sameBox(next, ext)) break;
    ext = next;
  }
  return ext;
}

function sortedUnique(values: number[], lo: number, hi: number): number[] {
  const out: number[] = [];
  for (const v of values.filter((x) => Number.isFinite(x) && x >= lo && x <= hi).sort((a, b) => a - b)) {
    if (!out.length || v - out[out.length - 1]! > EPS) out.push(v);
  }
  return out;
}

/** grid lines: ports, stub lines of source and target, midlines between them, obstacle borders ± margin, frame insets, shared tails (targetMerge) */
function gridLines(c: Ctx, ext: Box, inc: Box[], frame: Box | undefined): { xs: number[]; ys: number[] } {
  const xs: number[] = [], ys: number[] = [];
  for (const p of [...c.src, ...c.tgt]) {
    xs.push(p.x);
    ys.push(p.y);
  }
  for (const seg of c.segs) {
    if (seg.merge && seg.kind === 'v') xs.push(seg.a.x);
    if (seg.merge && seg.kind === 'h') ys.push(seg.a.y);
  }
  for (const b of [c.s, c.t]) {
    xs.push(b.x - c.stub, right(b) + c.stub);
    ys.push(b.y - c.stub, bottom(b) + c.stub);
  }
  const { s, t } = c;
  if (t.x > right(s)) xs.push(Math.round((right(s) + t.x) / 2));
  if (s.x > right(t)) xs.push(Math.round((right(t) + s.x) / 2));
  if (t.y > bottom(s)) ys.push(Math.round((bottom(s) + t.y) / 2));
  if (s.y > bottom(t)) ys.push(Math.round((bottom(t) + s.y) / 2));
  for (const o of inc) {
    xs.push(o.x - c.m, right(o) + c.m);
    ys.push(o.y - c.m, bottom(o) + c.m);
  }
  if (frame) {
    const ix = Math.round(Math.min(c.m, frame.width / 2)), iy = Math.round(Math.min(c.m, frame.height / 2));
    xs.push(frame.x + ix, right(frame) - ix);
    ys.push(frame.y + iy, bottom(frame) - iy);
  }
  return { xs: sortedUnique(xs, ext.x, right(ext)), ys: sortedUnique(ys, ext.y, bottom(ext)) };
}

function bump(arr: Float64Array, i: number, v: number): void {
  arr[i] = arr[i]! + v;
}

/** add `perEdge + perPx·length` to every grid edge running through the open interior of `b` */
function addInside(g: Grid, b: Box, perEdge: number, perPx: number): void {
  const { xs, ys, nx, ny } = g;
  for (let j = upper(ys, b.y); j < ny && ys[j]! < bottom(b); j++) {
    for (let i = Math.max(0, upper(xs, b.x) - 1); i < nx - 1 && xs[i]! < right(b); i++) {
      bump(g.hCost, j * (nx - 1) + i, perEdge + perPx * (xs[i + 1]! - xs[i]!));
    }
  }
  for (let i = upper(xs, b.x); i < nx && xs[i]! < right(b); i++) {
    for (let j = Math.max(0, upper(ys, b.y) - 1); j < ny - 1 && ys[j]! < bottom(b); j++) {
      bump(g.vCost, j * nx + i, perEdge + perPx * (ys[j + 1]! - ys[j]!));
    }
  }
}

/** add `cost` to every grid edge lying on the outline of `b` (a connection drawn along a shape's border) */
function addOutline(g: Grid, b: Box, cost: number): void {
  const { xs, ys, nx, ny } = g;
  for (const y of [b.y, bottom(b)]) {
    const j = lower(ys, y - EPS);
    if (j >= ny || Math.abs(ys[j]! - y) > EPS) continue;
    for (let i = Math.max(0, upper(xs, b.x) - 1); i < nx - 1 && xs[i]! < right(b); i++) {
      if (Math.min(xs[i + 1]!, right(b)) - Math.max(xs[i]!, b.x) > 1) bump(g.hCost, j * (nx - 1) + i, cost);
    }
  }
  for (const x of [b.x, right(b)]) {
    const i = lower(xs, x - EPS);
    if (i >= nx || Math.abs(xs[i]! - x) > EPS) continue;
    for (let j = Math.max(0, upper(ys, b.y) - 1); j < ny - 1 && ys[j]! < bottom(b); j++) {
      if (Math.min(ys[j + 1]!, bottom(b)) - Math.max(ys[j]!, b.y) > 1) bump(g.vCost, j * nx + i, cost);
    }
  }
}

/** a line crosses grid row j at x (a crossing exactly at a node is split between the two edges) */
function crossRow(g: Grid, j: number, x: number, cost = CROSS): void {
  const { xs, nx } = g;
  const k = lower(xs, x);
  if (k < nx && Math.abs(xs[k]! - x) < EPS) {
    if (k > 0) bump(g.hCost, j * (nx - 1) + k - 1, cost / 2);
    if (k < nx - 1) bump(g.hCost, j * (nx - 1) + k, cost / 2);
  } else if (k > 0 && k < nx) bump(g.hCost, j * (nx - 1) + k - 1, cost);
}

/** a line crosses grid column i at y */
function crossColumn(g: Grid, i: number, y: number, cost = CROSS): void {
  const { ys, nx, ny } = g;
  const k = lower(ys, y);
  if (k < ny && Math.abs(ys[k]! - y) < EPS) {
    if (k > 0) bump(g.vCost, (k - 1) * nx + i, cost / 2);
    if (k < ny - 1) bump(g.vCost, k * nx + i, cost / 2);
  } else if (k > 0 && k < ny) bump(g.vCost, (k - 1) * nx + i, cost);
}

function markLine(g: Grid, seg: Seg): void {
  const { xs, ys, nx, ny } = g;
  const { a, b } = seg;
  const x1 = Math.min(a.x, b.x), x2 = Math.max(a.x, b.x), y1 = Math.min(a.y, b.y), y2 = Math.max(a.y, b.y);
  // crossing next to the line's start / end (its arrowhead) costs more
  const cost = (p: Point): number => (seg.ends?.some((e) => Math.abs(e.x - p.x) + Math.abs(e.y - p.y) < END_ZONE) ? 2 * CROSS : CROSS);
  if (seg.kind !== 'h') {
    for (let j = upper(ys, y1); j < ny && ys[j]! < y2; j++) {
      const x = seg.kind === 'v' ? a.x : a.x + ((ys[j]! - a.y) * (b.x - a.x)) / (b.y - a.y);
      crossRow(g, j, x, cost({ x, y: ys[j]! }));
    }
  }
  if (seg.kind !== 'v') {
    for (let i = upper(xs, x1); i < nx && xs[i]! < x2; i++) {
      const y = seg.kind === 'h' ? a.y : a.y + ((xs[i]! - a.x) * (b.y - a.y)) / (b.x - a.x);
      crossColumn(g, i, y, cost({ x: xs[i]!, y }));
    }
  }
  // a join's entry may follow another entry's tail into the same vertex (targetMerge): marked apart. An overlap
  // counts from 1 px; on a tail every grid edge inside it counts, a short one too (a route leaving the tail there
  // pays the overlap in astar)
  const hFlag = seg.merge ? g.hMg : g.hOv, vFlag = seg.merge ? g.vMg : g.vOv;
  const least = (len: number): number => (seg.merge ? Math.min(1, len - EPS) : 1);
  if (seg.kind === 'h') {
    for (let j = lower(ys, a.y - OVERLAP_TOL); j < ny && ys[j]! <= a.y + OVERLAP_TOL; j++) {
      for (let i = Math.max(0, upper(xs, x1) - 1); i < nx - 1 && xs[i]! < x2; i++) {
        if (Math.min(xs[i + 1]!, x2) - Math.max(xs[i]!, x1) > least(xs[i + 1]! - xs[i]!)) hFlag[j * (nx - 1) + i] = 1;
      }
    }
  } else if (seg.kind === 'v') {
    for (let i = lower(xs, a.x - OVERLAP_TOL); i < nx && xs[i]! <= a.x + OVERLAP_TOL; i++) {
      for (let j = Math.max(0, upper(ys, y1) - 1); j < ny - 1 && ys[j]! < y2; j++) {
        if (Math.min(ys[j + 1]!, y2) - Math.max(ys[j]!, y1) > least(ys[j + 1]! - ys[j]!)) vFlag[j * nx + i] = 1;
      }
    }
  }
}

/**
 * A gateway target is touched only at its port: every grid edge through a
 * vertex of the diamond (the middle of a side of its box, where the ports
 * lie) costs HIT, except the first edge out of it (the stub into that port).
 */
function guardVertices(g: Grid, b: Box): void {
  const { xs, ys, nx, ny } = g;
  const at = (arr: number[], v: number): number => {
    const k = lower(arr, v - EPS);
    return k < arr.length && Math.abs(arr[k]! - v) < EPS ? k : -1;
  };
  for (const side of ['top', 'right', 'bottom', 'left'] as const) {
    const [lo, hi] = span(b, side);
    const v = pointOn(b, side, Math.round(lo + (hi - lo) / 2));
    const d = OUTWARD[side];
    const i = at(xs, v.x), j = at(ys, v.y);
    if (j >= 0) for (let k = 0; k + 1 < nx; k++) if (xs[k]! <= v.x + EPS && xs[k + 1]! >= v.x - EPS && !(d === 0 && k === i) && !(d === 2 && k + 1 === i)) bump(g.hCost, j * (nx - 1) + k, HIT);
    if (i >= 0) for (let k = 0; k + 1 < ny; k++) if (ys[k]! <= v.y + EPS && ys[k + 1]! >= v.y - EPS && !(d === 1 && k === j) && !(d === 3 && k + 1 === j)) bump(g.vCost, k * nx + i, HIT);
  }
}

/** nodes closer than the stub to a side of the source or target (turning there costs) */
function markStubZones(g: Grid, b: Box, stub: number): void {
  const { xs, ys, nx } = g;
  const zones: Array<{ x1: number; x2: number; y1: number; y2: number }> = [
    { x1: right(b), x2: right(b) + stub, y1: b.y, y2: bottom(b) },
    { x1: b.x - stub, x2: b.x, y1: b.y, y2: bottom(b) },
    { x1: b.x, x2: right(b), y1: bottom(b), y2: bottom(b) + stub },
    { x1: b.x, x2: right(b), y1: b.y - stub, y2: b.y },
  ];
  zones.forEach((z, k) => {
    for (let i = lower(xs, z.x1); i < nx && xs[i]! <= z.x2; i++) {
      for (let j = lower(ys, z.y1); j < ys.length && ys[j]! <= z.y2; j++) {
        const x = xs[i]!, y = ys[j]!;
        // the far edge of the zone (exactly one stub away) is outside it
        const inside = k === 0 ? x < z.x2 : k === 1 ? x > z.x1 : k === 2 ? y < z.y2 : y > z.y1;
        if (inside) g.turn[j * nx + i] = STUB_TURN;
      }
    }
  });
}

function buildGrid(c: Ctx, ext: Box, frame: Box | undefined): Grid {
  const inc = c.obstacles.filter((o) => touches(o, ext));
  const { xs, ys } = gridLines(c, ext, inc, frame);
  const nx = xs.length, ny = ys.length;
  const g: Grid = {
    xs,
    ys,
    nx,
    ny,
    hCost: new Float64Array(Math.max(0, nx - 1) * ny),
    vCost: new Float64Array(nx * Math.max(0, ny - 1)),
    hOv: new Uint8Array(Math.max(0, nx - 1) * ny),
    vOv: new Uint8Array(nx * Math.max(0, ny - 1)),
    anyOv: false,
    hMg: new Uint8Array(Math.max(0, nx - 1) * ny),
    vMg: new Uint8Array(nx * Math.max(0, ny - 1)),
    anyMg: false,
    turn: new Float64Array(nx * ny),
  };
  for (let j = 0; j < ny; j++) for (let i = 0; i + 1 < nx; i++) g.hCost[j * (nx - 1) + i] = xs[i + 1]! - xs[i]!;
  for (let j = 0; j + 1 < ny; j++) for (let i = 0; i < nx; i++) g.vCost[j * nx + i] = ys[j + 1]! - ys[j]!;
  for (const o of inc) {
    addInside(g, o, HIT, 0);
    addOutline(g, o, OVERLAP);
    if (c.m > 0) addInside(g, inflate(o, c.m), 0, NEAR);
  }
  addInside(g, c.s, HIT, 0);
  addInside(g, c.t, HIT, 0);
  if (c.tMiddle) guardVertices(g, c.t);
  const near = inflate(ext, OVERLAP_TOL + 1);
  for (const seg of c.segs) {
    const bb = { x: Math.min(seg.a.x, seg.b.x), y: Math.min(seg.a.y, seg.b.y), width: Math.abs(seg.a.x - seg.b.x), height: Math.abs(seg.a.y - seg.b.y) };
    if (touches(bb, near)) markLine(g, seg);
  }
  g.anyOv = g.hOv.some((v) => v === 1) || g.vOv.some((v) => v === 1);
  g.anyMg = g.hMg.some((v) => v === 1) || g.vMg.some((v) => v === 1);
  markStubZones(g, c.s, c.stub);
  markStubZones(g, c.t, c.stub);
  return g;
}

// ---------------------------------------------------------------- A*

/**
 * Binary min-heap of search entries ordered by (f, h, insertion order); the
 * insertion order makes ties deterministic. Entries live in growable typed
 * arrays (index = insertion order), the heap holds their indices.
 */
class Heap {
  f = new Float64Array(256);
  h = new Float64Array(256);
  g = new Float64Array(256);
  state = new Int32Array(256);
  private heap = new Int32Array(256);
  private count = 0;
  size = 0;

  private before(a: number, b: number): boolean {
    const fa = this.f[a]!, fb = this.f[b]!;
    if (fa !== fb) return fa < fb;
    const ha = this.h[a]!, hb = this.h[b]!;
    return ha !== hb ? ha < hb : a < b;
  }

  private grow(): void {
    const n = this.f.length * 2;
    const f = new Float64Array(n), h = new Float64Array(n), g = new Float64Array(n), st = new Int32Array(n), hp = new Int32Array(n);
    f.set(this.f);
    h.set(this.h);
    g.set(this.g);
    st.set(this.state);
    hp.set(this.heap);
    [this.f, this.h, this.g, this.state, this.heap] = [f, h, g, st, hp];
  }

  push(state: number, g: number, h: number): void {
    if (this.count === this.f.length) this.grow();
    const id = this.count++;
    this.f[id] = g + h;
    this.h[id] = h;
    this.g[id] = g;
    this.state[id] = state;
    const a = this.heap;
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.before(id, a[p]!)) break;
      a[i] = a[p]!;
      i = p;
    }
    a[i] = id;
  }

  /** index of the smallest entry (read it from `state` / `g`), removed from the heap */
  pop(): number {
    const a = this.heap;
    const top = a[0]!;
    const last = a[--this.size]!;
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      if (l >= this.size) break;
      const r = l + 1;
      const m = r < this.size && this.before(a[r]!, a[l]!) ? r : l;
      if (!this.before(a[m]!, last)) break;
      a[i] = a[m]!;
      i = m;
    }
    a[i] = last;
    return top;
  }
}

interface Found {
  points: Point[];
  cost: number;
}

/** grid node of a port (ports are always grid lines; undefined when outside the region) */
function nodeOf(g: Grid, p: Point): number | undefined {
  const i = lower(g.xs, p.x), j = lower(g.ys, p.y);
  if (i >= g.nx || j >= g.ny || Math.abs(g.xs[i]! - p.x) > EPS || Math.abs(g.ys[j]! - p.y) > EPS) return undefined;
  return j * g.nx + i;
}

/**
 * A* from the source ports (leaving outward) to a target port (arriving
 * inward). State = (node, direction, run: 0 free, 1 on an overlap run, 2 on
 * a shared tail); no U-turns; a start state may only go straight on (the
 * stub). Running on a shared tail is free; leaving it before the goal costs
 * OVERLAP (it was an overlap after all). Heuristic: Manhattan distance plus
 * 150 per bend that is unavoidable given the current and the final direction
 * (consistent, so the first goal popped is optimal).
 */
function astar(c: Ctx, g: Grid): Found | undefined {
  const { xs, ys, nx, ny } = g;
  if (!nx || !ny) return undefined;
  const nOv = g.anyMg ? 3 : g.anyOv ? 2 : 1;

  const goalNode = new Uint8Array(nx * ny);
  const goals = new Map<number, number>(); // node·4 + inward direction -> port cost
  const tx: number[] = [], ty: number[] = [], te: number[] = [];
  for (const p of c.tgt) {
    const node = nodeOf(g, p);
    if (node === undefined) continue;
    const e = (OUTWARD[p.side] + 2) % 4;
    const key = node * 4 + e;
    if (!goals.has(key) || goals.get(key)! > p.cost) goals.set(key, p.cost);
    goalNode[node] = 1;
    tx.push(p.x);
    ty.push(p.y);
    te.push(e);
  }
  if (!tx.length) return undefined;
  const h = (node: number, dir: number): number => {
    const x = xs[node % nx]!, y = ys[Math.floor(node / nx)]!;
    let best = Infinity;
    for (let k = 0; k < tx.length; k++) {
      const qx = tx[k]!, qy = ty[k]!, e = te[k]!;
      let bends: number;
      if (dir === e) {
        const ahead = e === 0 ? y === qy && qx >= x : e === 2 ? y === qy && qx <= x : e === 1 ? x === qx && qy >= y : x === qx && qy <= y;
        bends = ahead ? 0 : 2;
      } else bends = dir === (e + 2) % 4 ? 2 : 1;
      const v = Math.abs(x - qx) + Math.abs(y - qy) + BEND * bends;
      if (v < best) best = v;
    }
    return best;
  };

  const gs = new Float64Array(nx * ny * 4 * nOv).fill(Infinity);
  const parent = new Int32Array(gs.length).fill(-2);
  const heap = new Heap();
  for (const p of c.src) {
    const node = nodeOf(g, p);
    if (node === undefined) continue;
    const dir = OUTWARD[p.side];
    const st = node * 4 * nOv + dir * nOv;
    if (p.cost >= gs[st]!) continue;
    gs[st] = p.cost;
    parent[st] = -1;
    heap.push(st, p.cost, h(node, dir));
  }

  while (heap.size) {
    const id = heap.pop();
    const st = heap.state[id]!, cg = heap.g[id]!;
    if (cg > gs[st]!) continue;
    const ov = st % nOv;
    const nd4 = (st - ov) / nOv;
    const dir = nd4 % 4;
    const node = (nd4 - dir) / 4;
    const start = parent[st] === -1;
    if (!start && goalNode[node] && goals.has(nd4)) return { points: trace(st, parent, nOv, g), cost: cg };
    const i = node % nx, j = (node - i) / nx;
    for (let k = 0; k < (start ? 1 : 3); k++) {
      const d = k === 0 ? dir : k === 1 ? (dir + 1) % 4 : (dir + 3) % 4;
      const ni = i + DX[d]!, nj = j + DY[d]!;
      if (ni < 0 || nj < 0 || ni >= nx || nj >= ny) continue;
      let cost: number, ovEdge: number, mgEdge: number;
      if (d === 0 || d === 2) {
        const e = j * (nx - 1) + (d === 0 ? i : i - 1);
        cost = g.hCost[e]!;
        ovEdge = g.hOv[e]!;
        mgEdge = g.hMg[e]!;
      } else {
        const e = (d === 1 ? j : j - 1) * nx + i;
        cost = g.vCost[e]!;
        ovEdge = g.vOv[e]!;
        mgEdge = g.vMg[e]!;
      }
      let ng = cg + cost;
      if (d !== dir) ng += BEND + g.turn[node]!;
      let nov = 0;
      if (ovEdge) {
        nov = 1;
        if (!(ov === 1 && d === dir)) ng += OVERLAP;
      } else if (mgEdge) nov = 2;
      // a shared tail left before the vertex was an overlap after all
      if (ov === 2 && nov !== 2) ng += OVERLAP;
      const nn = nj * nx + ni;
      const goalCost = goalNode[nn] ? goals.get(nn * 4 + d) : undefined;
      if (goalCost !== undefined) ng += goalCost;
      const ns = (nn * 4 + d) * nOv + nov;
      if (ng < gs[ns]!) {
        gs[ns] = ng;
        parent[ns] = st;
        heap.push(ns, ng, goalCost !== undefined ? 0 : h(nn, d));
      }
    }
  }
  return undefined;
}

function trace(goal: number, parent: Int32Array, nOv: number, g: Grid): Point[] {
  const pts: Point[] = [];
  for (let st = goal; st >= 0; st = parent[st]!) {
    const node = Math.floor(Math.floor(st / nOv) / 4);
    pts.push({ x: g.xs[node % g.nx]!, y: g.ys[Math.floor(node / g.nx)]! });
    if (parent[st] === -1) break;
  }
  return simplify(pts.reverse());
}

// ---------------------------------------------------------------- evaluation and finishing

interface Score {
  hits: number;
  /** crossings and overlaps with `lines`, weighted */
  penalty: number;
}

function score(points: Point[], c: Ctx): Score {
  let hits = 0, penalty = 0;
  const boxes = [...c.obstacles, c.s, c.t];
  // the route's last segments on shared tails (targetMerge) follow them into the vertex: no overlap there
  const onTail = (k: number): boolean => c.segs.some((seg) => seg.merge && segmentsOverlap(points[k]!, points[k + 1]!, seg.a, seg.b));
  let tail = points.length - 1;
  while (tail > 0 && onTail(tail - 1)) tail--;
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i]!, b = points[i + 1]!;
    for (const box of boxes) if (segmentHitsBox(a, b, box)) hits++;
    for (const seg of c.segs) {
      if (segmentsCross(a, b, seg.a, seg.b)) penalty += CROSS;
      else if ((!seg.merge || i < tail) && segmentsOverlap(a, b, seg.a, seg.b)) penalty += OVERLAP;
    }
  }
  return { hits, penalty };
}

interface Attempt extends Found {
  hits: number;
}

function attempt(c: Ctx, wide: boolean, frame: Box | undefined): Attempt | undefined {
  const found = astar(c, buildGrid(c, region(c, wide, frame), frame));
  return found && { ...found, hits: score(found.points, c).hits };
}

function better(a: Attempt | undefined, b: Attempt | undefined): Attempt | undefined {
  if (!a || !b) return a ?? b;
  return b.hits < a.hits || (b.hits === a.hits && b.cost < a.cost) ? b : a;
}

/** the simplest orthogonal route between the first allowed ports (only when the search finds nothing) */
function directRoute(c: Ctx): Point[] {
  const p = c.src[0] ?? { ...pointOn(c.s, 'right', c.s.y + c.s.height / 2), side: 'right' as Side, cost: 0 };
  const q = c.tgt[0] ?? { ...pointOn(c.t, 'left', c.t.y + c.t.height / 2), side: 'left' as Side, cost: 0 };
  const a = { x: p.x, y: p.y }, b = { x: q.x, y: q.y };
  if (a.x === b.x || a.y === b.y) return simplify([a, b]);
  const hp = p.side === 'left' || p.side === 'right';
  const hq = q.side === 'left' || q.side === 'right';
  if (hp && hq) {
    const mx = Math.round((a.x + b.x) / 2);
    return simplify([a, { x: mx, y: a.y }, { x: mx, y: b.y }, b]);
  }
  if (!hp && !hq) {
    const my = Math.round((a.y + b.y) / 2);
    return simplify([a, { x: a.x, y: my }, { x: b.x, y: my }, b]);
  }
  return simplify(hp ? [a, { x: b.x, y: a.y }, b] : [a, { x: a.x, y: b.y }, b]);
}

/**
 * Centre the middle segment of a Z (p[k]-p[k+1], both neighbours running the
 * same way) in its free channel: between the obstacles (± margin) beside it and
 * the stubs of the end segments. Kept only when it hits and crosses no more.
 */
function centreJog(p: Point[], k: number, c: Ctx): Point[] | undefined {
  const a = p[k - 1]!, b = p[k]!, q = p[k + 1]!, d = p[k + 2]!;
  const vertical = b.x === q.x;
  if (vertical ? a.y !== b.y || q.y !== d.y : a.x !== b.x || q.x !== d.x) return undefined;
  const along = (pt: Point): number => (vertical ? pt.x : pt.y);
  const dir = Math.sign(along(b) - along(a));
  if (dir === 0 || dir !== Math.sign(along(d) - along(q))) return undefined;
  const from = along(a) + (k === 1 ? dir * c.stub : 0);
  const to = along(d) - (k + 2 === p.length - 1 ? dir * c.stub : 0);
  if (dir * (to - from) < 0) return undefined;
  let lo = Math.min(from, to), hi = Math.max(from, to);
  const at = along(b);
  const s1 = Math.min(vertical ? b.y : b.x, vertical ? q.y : q.x);
  const s2 = Math.max(vertical ? b.y : b.x, vertical ? q.y : q.x);
  const blockers = [...c.obstacles.map((o) => inflate(o, c.m)), inflate(c.s, c.stub), inflate(c.t, c.stub)];
  for (const o of blockers) {
    const olo = vertical ? o.x : o.y, ohi = vertical ? right(o) : bottom(o);
    const clo = vertical ? o.y : o.x, chi = vertical ? bottom(o) : right(o);
    if (chi < s1 || clo > s2) continue;
    if (ohi <= at) lo = Math.max(lo, ohi);
    else if (olo >= at) hi = Math.min(hi, olo);
    else return undefined;
  }
  if (hi < lo) return undefined;
  const v = Math.round((lo + hi) / 2);
  if (Math.abs(v - at) < 1) return undefined;
  const moved = p.map((pt) => ({ ...pt }));
  if (vertical) {
    moved[k]!.x = v;
    moved[k + 1]!.x = v;
  } else {
    moved[k]!.y = v;
    moved[k + 1]!.y = v;
  }
  const before = score(p, c), after = score(moved, c);
  return after.hits <= before.hits && after.penalty <= before.penalty ? moved : undefined;
}

function centreJogs(points: Point[], c: Ctx): Point[] {
  let out = points;
  for (let k = 1; k + 2 < out.length; k++) out = centreJog(out, k, c) ?? out;
  return simplify(out);
}

/** Route one connection orthogonally from `source` to `target` (see the module header for the contract). */
export function routeOrthogonal(req: RouteRequest): Point[] {
  const c = context(req);
  const frame = req.frame && finiteBox(req.frame) ? union(req.frame, union(c.s, c.t)) : undefined;
  let best = attempt(c, false, frame);
  if (!best || best.hits > 0) best = better(best, attempt(c, true, frame));
  // gaps narrower than two margins have no grid line: look again with a thin margin
  const thin = c.m > THIN_MARGIN ? { ...c, m: THIN_MARGIN } : undefined;
  if (thin && (!best || best.hits > 0)) best = better(best, attempt(thin, true, frame));
  if (frame && (!best || best.hits > 0)) {
    const free = better(attempt(c, true, undefined), thin && attempt(thin, true, undefined));
    if (free && free.hits === 0) best = free;
  }
  return centreJogs(best ? best.points : directRoute(c), c);
}
