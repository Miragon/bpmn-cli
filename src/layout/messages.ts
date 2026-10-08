/**
 * Message flows of a collaboration in the clean engine: the vertical order of
 * the pools and the routes between them. Pure geometry on absolute boxes.
 *
 * Contract:
 *  - `poolOrder(pools, jobs)`: the permutation of the pools whose message
 *    flows cut the fewest shapes when they leave their element straight up or
 *    down to the pool border (running on top of a drawn flow counts as one
 *    cut; a flow between pools that are not neighbours costs SKIP per pool
 *    in between). Only a strictly better order replaces
 *    the declaration order, so a collaboration whose flows are already clean
 *    keeps its order. More than MAX_PERMUTED pools: declaration order.
 *  - `routeMessageFlows(jobs, pools)`: every flow leaves its element
 *    vertically, runs on its own horizontal channel in the gap between two
 *    pools and enters the other element vertically, from the middle of its
 *    border (a task: beside the middle when the middle is not clean). When
 *    no straight vertical between an element and its pool border is clean
 *    (it cuts a shape, e.g. a node of a lower lane, or runs on top of a
 *    drawn flow), the leg jogs sideways right outside the element into the
 *    free vertical corridor (usually a column gap) with the fewest cuts,
 *    crossings and parallel runs, and runs to the border there. A flow whose pools are not neighbours uses the gap
 *    next to its own pool, a vertical run right of all pools and the gap next
 *    to the other pool. A pool end docks right above / below the other end.
 *  - deterministic; obstacles are leaf shapes (no pools, lanes or expanded
 *    sub-process frames), `lines` the edges already drawn inside a pool.
 */
import { is, type El } from '../model.js';
import { SIZES, center, type Box, type Point } from './types.js';

export type Seg = [Point, Point];

/** One pool as the message flow router sees it. */
export interface MessagePool {
  box: Box;
  /** leaf shapes drawn inside the pool */
  obstacles: Box[];
  /** edges drawn inside the pool */
  lines: Seg[];
  /** x where the pool's content area starts (after the pool and lane headers) */
  contentLeft: number;
}

export interface MessageFlowJob {
  el: El;
  source: El;
  target: El;
  sourceBox: Box;
  targetBox: Box;
  /** boxes that belong to the end itself (its boundary events): never obstacles */
  sourceOwn: Box[];
  targetOwn: Box[];
  sourcePool?: MessagePool;
  targetPool?: MessagePool;
}

/** cost of a flow between pools that are not neighbours, per pool in between */
const SKIP = 2;
/** more pools than this keep their declaration order (permutations explode) */
const MAX_PERMUTED = 6;
/** distance of a jog from the element border */
const JOG = 15;
/** a jog keeps this distance to the shapes beside its vertical */
const CLEAR = 20;
/** lines closer than this run "along" each other */
const NEAR = 8;

/* ------------------------------------------------------------------ */
/* geometry                                                             */
/* ------------------------------------------------------------------ */

function segs(points: Point[]): Seg[] {
  const out: Seg[] = [];
  for (let i = 0; i + 1 < points.length; i++) out.push([points[i]!, points[i + 1]!]);
  return out;
}

/** a segment cuts a box (touching its border does not count) */
function cuts([p, q]: Seg, b: Box): boolean {
  return Math.min(p.x, q.x) < b.x + b.width - 1 && Math.max(p.x, q.x) > b.x + 1 && Math.min(p.y, q.y) < b.y + b.height - 1 && Math.max(p.y, q.y) > b.y + 1;
}

function hits(points: Point[], boxes: Box[]): number {
  let n = 0;
  for (const b of boxes) if (segs(points).some((s) => cuts(s, b))) n++;
  return n;
}

/** Proper crossing of two segments (shared endpoints and collinear overlaps do not count). */
export function properCross([a, b]: Seg, [c, d]: Seg): boolean {
  const o = (p: Point, q: Point, r: Point): number => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  const o1 = o(a, b, c), o2 = o(a, b, d), o3 = o(c, d, a), o4 = o(c, d, b);
  return o1 !== o2 && o3 !== o4 && o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0;
}

function crossings(points: Point[], lines: Seg[]): number {
  let n = 0;
  for (const a of segs(points)) for (const b of lines) if (properCross(a, b)) n++;
  return n;
}

/** overlap of two ranges */
function overlapLength(a1: number, a2: number, b1: number, b2: number): number {
  return Math.min(Math.max(a1, a2), Math.max(b1, b2)) - Math.max(Math.min(a1, a2), Math.min(b1, b2));
}

/**
 * Cost of running along drawn lines: 300 per segment on top of a parallel
 * line, 30 per segment closer than NEAR px to one (hard to tell apart).
 */
function alongCost(points: Point[], lines: Seg[]): number {
  let cost = 0;
  for (const [p, q] of segs(points)) {
    const vertical = p.x === q.x;
    for (const [a, b] of lines) {
      if (vertical ? a.x !== b.x : a.y !== b.y) continue;
      const off = vertical ? Math.abs(a.x - p.x) : Math.abs(a.y - p.y);
      if (off >= NEAR) continue;
      const len = vertical ? overlapLength(p.y, q.y, a.y, b.y) : overlapLength(p.x, q.x, a.x, b.x);
      if (len > 0) cost += off < 1 ? 300 : 30;
    }
  }
  return cost;
}

/* ------------------------------------------------------------------ */
/* legs: element border <-> pool border                                 */
/* ------------------------------------------------------------------ */

/** The vertical piece of a flow inside one pool, from the element border to the x where it reaches the pool border. */
interface Leg {
  /** element border first; the last point's x is where the leg crosses the pool border */
  points: Point[];
  x: number;
}

/** shapes that count as obstacles for an end (the pool's obstacles are the same box objects as the ends) */
function obstaclesFor(pool: MessagePool, box: Box, own: Box[]): Box[] {
  return pool.obstacles.filter((o) => o !== box && !own.includes(o));
}

/** shapes the straight vertical from an element to its pool border cuts, plus 1 when it runs on top of a drawn line */
function straightHits(box: Box, own: Box[], pool: MessagePool | undefined, up: boolean): number {
  if (!pool) return 0;
  const x = Math.round(box.x + box.width / 2);
  const from = up ? box.y : box.y + box.height;
  const to = up ? pool.box.y : pool.box.y + pool.box.height;
  const line = [{ x, y: from }, { x, y: to }];
  return hits(line, obstaclesFor(pool, box, own)) + (alongCost(line, pool.lines) >= 300 ? 1 : 0);
}

/** Free x positions for a vertical between `y1` and `y2` inside the pool: gaps between the shapes in that corridor. */
function corridorXs(pool: MessagePool, obstacles: Box[], y1: number, y2: number, near: number): number[] {
  const lo = Math.min(y1, y2), hi = Math.max(y1, y2);
  const spans = obstacles
    .filter((o) => o.y < hi && o.y + o.height > lo)
    .map((o) => [o.x - CLEAR, o.x + o.width + CLEAR] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  const left = pool.contentLeft + CLEAR, right = pool.box.x + pool.box.width - CLEAR;
  const out: number[] = [];
  let cursor = left;
  const gap = (a: number, b: number): void => {
    if (b < a) return;
    // narrow gaps (a column gap): the middle or beside it (the engine's own lines use the middle); wide ones: as close to `near` as they allow
    if (b - a > 120) out.push(Math.round(Math.min(Math.max(near, a + 20), b - 20)));
    else out.push(Math.round((a + b) / 2), Math.round((a + b) / 2 - Math.min(10, (b - a) / 2)), Math.round((a + b) / 2 + Math.min(10, (b - a) / 2)));
  };
  for (const [a, b] of spans) {
    gap(cursor, Math.min(a, right));
    cursor = Math.max(cursor, b);
  }
  gap(cursor, right);
  return out;
}

/** Where a leg may leave the element: the middle of the border, on a task also beside it (sequence flows use the middle). */
function exitXs(box: Box): number[] {
  const cx = Math.round(box.x + box.width / 2);
  return box.width >= 100 ? [cx, cx - 25, cx + 25] : [cx];
}

/**
 * The leg of an end: straight when nothing is in the way (from the middle of
 * the border, else from beside it), else a jog right outside the element
 * into the corridor with the fewest cut shapes and crossings, nearest first.
 */
function legOf(box: Box, own: Box[], pool: MessagePool | undefined, up: boolean, el: El): Leg {
  const edge = up ? box.y : box.y + box.height;
  const exits = exitXs(box);
  const straight = (x: number): Leg => ({ points: [{ x, y: edge }], x });
  if (!pool || is(el, 'bpmn:Participant')) return straight(exits[0]!);
  const border = up ? pool.box.y : pool.box.y + pool.box.height;
  const obstacles = obstaclesFor(pool, box, own);
  const score = (pts: Point[]): number => hits(pts, obstacles) * 1000 + crossings(pts, pool.lines) * 5 + alongCost(pts, pool.lines);
  // a straight line that cuts no shape and does not run on top of a drawn flow: the middle first, else the one crossing the fewest lines
  const clean = exits
    .map((x, i) => ({ x, line: [{ x, y: edge }, { x, y: border }], i }))
    .filter(({ line }) => !hits(line, obstacles) && alongCost(line, pool.lines) < 300)
    .map(({ x, line, i }) => ({ x, score: i === 0 ? -1 : crossings(line, pool.lines) * 5 + i }));
  if (clean.length) return straight(clean.reduce((a, b) => (b.score < a.score ? b : a)).x);
  // the jog runs below the boundary events hanging out of the bottom border
  const reach = up ? box.y : Math.max(box.y + box.height, ...own.map((o) => o.y + o.height));
  const jy = Math.round(up ? reach - JOG : reach + JOG);
  let best: { leg: Leg; score: number } = { leg: straight(exits[0]!), score: score([{ x: exits[0]!, y: edge }, { x: exits[0]!, y: border }]) };
  exits.forEach((ex, i) => {
    for (const x of corridorXs(pool, obstacles, jy, border, ex)) {
      const points = [{ x: ex, y: edge }, { x: ex, y: jy }, { x, y: jy }];
      const total = score([...points, { x, y: border }]) + Math.abs(x - ex) * 0.01 + i;
      if (total < best.score) best = { leg: { points, x }, score: total };
    }
  });
  return best.leg;
}

/* ------------------------------------------------------------------ */
/* pool order                                                           */
/* ------------------------------------------------------------------ */

function permutations<T>(list: T[]): T[][] {
  if (list.length <= 1) return [list];
  const out: T[][] = [];
  list.forEach((item, i) => {
    for (const rest of permutations([...list.slice(0, i), ...list.slice(i + 1)])) out.push([item, ...rest]);
  });
  return out;
}

/** The pool order whose message flows cut the fewest shapes (declaration order on ties). */
export function poolOrder(pools: MessagePool[], jobs: MessageFlowJob[]): MessagePool[] {
  if (pools.length < 2 || pools.length > MAX_PERMUTED || !jobs.length) return pools;
  // hits of every end when it leaves upwards / downwards: independent of the order
  const endCost = (box: Box, own: Box[], el: El, pool?: MessagePool): { up: number; down: number } => {
    const inside = is(el, 'bpmn:Participant') ? undefined : pool; // a pool end has nothing in its way
    return { up: straightHits(box, own, inside, true), down: straightHits(box, own, inside, false) };
  };
  const ends = jobs
    .filter((j) => j.sourcePool && j.targetPool && j.sourcePool !== j.targetPool)
    .map((j) => ({ a: j.sourcePool!, b: j.targetPool!, source: endCost(j.sourceBox, j.sourceOwn, j.source, j.sourcePool), target: endCost(j.targetBox, j.targetOwn, j.target, j.targetPool) }));
  if (!ends.length) return pools;
  const cost = (order: MessagePool[]): number => {
    let total = 0;
    for (const e of ends) {
      const ia = order.indexOf(e.a), ib = order.indexOf(e.b);
      const down = ia < ib;
      total += (down ? e.source.down : e.source.up) + (down ? e.target.up : e.target.down);
      total += SKIP * Math.max(0, Math.abs(ia - ib) - 1);
    }
    return total;
  };
  let best = pools;
  let bestCost = cost(pools);
  for (const order of permutations(pools)) {
    if (bestCost === 0) break;
    const c = cost(order);
    if (c < bestCost) {
      best = order;
      bestCost = c;
    }
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* routes                                                               */
/* ------------------------------------------------------------------ */

/** Polyline of a message flow that crosses one gap on channel `y` (for the crossing count). */
function gapPolyline(sx: number, tx: number, y: number, above: number, below: number): Point[] {
  return [{ x: sx, y: above }, { x: sx, y }, { x: tx, y }, { x: tx, y: below }];
}

/** Permutation of the flows in one gap whose channels produce the fewest crossings. */
function bestChannelOrder<T extends { sx: number; tx: number; down: boolean }>(list: T[], level: (i: number, n: number) => number, range: { top: number; bottom: number }): T[] {
  const crossingsOf = (order: T[]): number => {
    const lines = order.map((p, i) => gapPolyline(p.sx, p.tx, level(i, order.length), p.down ? range.top - 1 : range.bottom + 1, p.down ? range.bottom + 1 : range.top - 1));
    let n = 0;
    for (let i = 0; i < lines.length; i++) {
      for (let j = i + 1; j < lines.length; j++) {
        for (const a of segs(lines[i]!)) for (const b of segs(lines[j]!)) if (properCross(a, b)) n++;
      }
    }
    return n;
  };
  let best = list;
  let bestCount = crossingsOf(list);
  const permute = (rest: T[], acc: T[]): void => {
    if (bestCount === 0) return;
    if (!rest.length) {
      const n = crossingsOf(acc);
      if (n < bestCount) {
        bestCount = n;
        best = acc;
      }
      return;
    }
    rest.forEach((item, i) => permute([...rest.slice(0, i), ...rest.slice(i + 1)], [...acc, item]));
  };
  permute(list, []);
  return best;
}

/** x where a flow docks on a pool: right above / below the other end, inside the pool. */
function poolDockX(box: Box, otherX: number): number {
  return Math.round(Math.min(Math.max(otherX, box.x + 40), box.x + box.width - 40));
}

interface Plan {
  job: MessageFlowJob;
  /** element legs (element border first) */
  sourceLeg: Leg;
  targetLeg: Leg;
  /** x where the flow enters the gap(s) */
  sx: number;
  tx: number;
  /** gap indexes this flow runs in */
  gaps: number[];
  outside: boolean;
  /** the flow runs downwards (source pool above the target pool) */
  down: boolean;
}

function planOf(job: MessageFlowJob, pools: MessagePool[]): Plan {
  const indexOf = (p?: MessagePool): number => (p ? pools.indexOf(p) : -1);
  const a = indexOf(job.sourcePool), b = indexOf(job.targetPool);
  const down = a < b || (a === b && center(job.sourceBox).y < center(job.targetBox).y) || b < 0;
  const sourcePool = is(job.source, 'bpmn:Participant');
  const targetPool = is(job.target, 'bpmn:Participant');
  let sourceLeg = legOf(job.sourceBox, job.sourceOwn, job.sourcePool, !down, job.source);
  let targetLeg = legOf(job.targetBox, job.targetOwn, job.targetPool, down, job.target);
  // a pool end docks right above / below the element end
  if (sourcePool && !targetPool) sourceLeg = dockLeg(job.sourceBox, targetLeg.x, !down);
  if (targetPool && !sourcePool) targetLeg = dockLeg(job.targetBox, sourceLeg.x, down);
  if (sourcePool && targetPool) {
    sourceLeg = dockLeg(job.sourceBox, center(job.targetBox).x, !down);
    targetLeg = dockLeg(job.targetBox, center(job.sourceBox).x, down);
  }
  const sx = sourceLeg.x, tx = targetLeg.x;
  if (a < 0 || b < 0 || Math.abs(a - b) === 1) return { job, sourceLeg, targetLeg, sx, tx, gaps: [Math.min(a, b) < 0 ? 0 : Math.min(a, b)], outside: false, down };
  return { job, sourceLeg, targetLeg, sx, tx, gaps: [a < b ? a : a - 1, a < b ? b - 1 : b], outside: true, down };
}

function dockLeg(box: Box, otherX: number, up: boolean): Leg {
  const x = poolDockX(box, otherX);
  return { points: [{ x, y: up ? box.y : box.y + box.height }], x };
}

/** Collinear interior points removed, consecutive duplicates dropped. */
function simplify(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const q = { x: Math.round(p.x), y: Math.round(p.y) };
    const last = out[out.length - 1];
    if (last && last.x === q.x && last.y === q.y) continue;
    const prev = out[out.length - 2];
    if (last && prev && ((prev.x === last.x && last.x === q.x) || (prev.y === last.y && last.y === q.y))) out.pop();
    out.push(q);
  }
  return out;
}

/** Routes every message flow (see the module contract); `pools` in their final top-to-bottom order. */
export function routeMessageFlows(jobs: MessageFlowJob[], pools: MessagePool[]): Array<{ el: El; points: Point[]; channelY?: number }> {
  const rightEdge = Math.max(0, ...pools.map((p) => p.box.x + p.box.width));
  /** the gap between pool i and pool i+1 */
  const gapRange = (i: number): { top: number; bottom: number } => {
    const upper = pools[i], lower = pools[i + 1];
    const top = upper ? upper.box.y + upper.box.height : (lower?.box.y ?? 0) - SIZES.poolGap;
    const bottom = lower ? lower.box.y : (upper ? upper.box.y + upper.box.height : 0) + SIZES.poolGap;
    return { top, bottom };
  };
  const plans = jobs.map((job) => planOf(job, pools));
  // one channel per flow and gap: flows that start further left get the upper channel
  const channels = new Map<string, number>();
  const byGap = new Map<number, Plan[]>();
  for (const plan of plans) for (const g of new Set(plan.gaps)) byGap.set(g, [...(byGap.get(g) ?? []), plan]);
  for (const [g, list] of byGap) {
    const range = gapRange(g);
    const level = (i: number, n: number): number => Math.round(range.top + ((i + 1) * (range.bottom - range.top)) / (n + 1));
    const sorted = [...list].sort((p, q) => Math.min(p.sx, p.tx) - Math.min(q.sx, q.tx));
    // pick the channel order with the fewest crossings (few flows per gap, so try them all)
    const order = sorted.length <= 5 ? bestChannelOrder(sorted, level, range) : sorted;
    order.forEach((plan, i) => channels.set(`${g}|${plans.indexOf(plan)}`, level(i, order.length)));
  }
  return plans.map((plan, index) => {
    const { job, sx, tx, sourceLeg, targetLeg } = plan;
    const lead = sourceLeg.points;
    const tail = [...targetLeg.points].reverse();
    const sy = lead[lead.length - 1]!.y, ty = tail[0]!.y;
    let middle: Point[];
    let channelY: number | undefined;
    if (!plan.outside) {
      const y = channels.get(`${plan.gaps[0]}|${index}`) ?? Math.round((sy + ty) / 2);
      middle = Math.abs(sx - tx) < 1 ? [] : [{ x: sx, y }, { x: tx, y }];
      // a straight flow carries its label in the middle of the gap
      const range = gapRange(plan.gaps[0]!);
      channelY = middle.length ? y : Math.round((range.top + range.bottom) / 2);
    } else {
      const outX = Math.round(rightEdge + 30 + index * 25);
      const y1 = channels.get(`${plan.gaps[0]}|${index}`) ?? sy;
      const y2 = channels.get(`${plan.gaps[1]}|${index}`) ?? ty;
      middle = [{ x: sx, y: y1 }, { x: outX, y: y1 }, { x: outX, y: y2 }, { x: tx, y: y2 }];
      channelY = y1;
    }
    return { el: job.el, points: simplify([...lead, ...middle, ...tail]), ...(channelY !== undefined ? { channelY } : {}) };
  });
}

/** Label of a named message flow: above its channel segment (in the gap between the pools), else beside its line (straight flows: in the gap). */
export function messageLabel(pts: Point[], name: string, channelY?: number): Box {
  const width = Math.min(90, name.length * 7 + 4);
  const height = 14 * Math.max(1, Math.ceil((name.length * 7) / 90));
  const i = channelY === undefined ? -1 : pts.findIndex((p, k) => k + 1 < pts.length && p.y === channelY && pts[k + 1]!.y === channelY);
  const horizontal = i >= 0 ? [pts[i]!, pts[i + 1]!] : pts.length >= 3 ? [pts[1]!, pts[2]!] : [pts[0]!, pts[1]!];
  if (horizontal[0]!.y === horizontal[1]!.y) {
    return { x: Math.min(horizontal[0]!.x, horizontal[1]!.x) + 8, y: horizontal[0]!.y - height - 4, width, height };
  }
  // a straight flow: beside its line, in the gap between the pools
  const a = pts[0]!, b = pts[1]!;
  const y = channelY !== undefined && pts.length === 2 ? channelY : (a.y + b.y) / 2;
  return { x: a.x + 6, y: y - height / 2, width, height };
}
