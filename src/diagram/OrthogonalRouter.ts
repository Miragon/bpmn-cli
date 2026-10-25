import { bottom, equalBoxes, grow, right, segmentHitsBox, union } from './utils/geom.js';
import type { Box, Point, Side } from './types.js';
import { SOURCE_DEFAULT, TARGET_DEFAULT } from './utils/sides.js';
import { RouteGrid } from './RouteGrid.js';
import { SearchHeap } from './SearchHeap.js';
import { AVOID, BEND, CROSS, DX, DY, EPS, HIT, MIN_STUB, NEAR, OUTWARD, OVERLAP, OVERLAP_TOL, PORT_OFFSET, PORT_SLOPE, REGION_PAD, SRC_RANK, TGT_RANK, THIN_MARGIN, pointOn, segmentsCross, simplify, span, type Port, type Seg } from './utils/routing.js';

export interface RouteRequest {
  source: Box;
  target: Box;
  /** most preferred first (default: all four) */
  sourceSides?: Side[];
  /** most preferred first (default: all four) */
  targetSides?: Side[];
  /** ports stay at the middle of their side: a gateway's vertices */
  sourceMiddle?: boolean;
  targetMiddle?: boolean;
  /** sides other connections of the shape use: a port there costs AVOID */
  sourceAvoid?: Side[];
  targetAvoid?: Side[];
  /**
   * the target is a join: following the common tail of the lines into its top / bottom port is
   * no overlap, since the entries share that vertex; crossing the tail still costs
   */
  targetMerge?: boolean;
  /** neither source nor target; the caller excludes containers */
  obstacles: Box[];
  lines?: Point[][];
  frame?: Box;
  margin?: number;
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
  /** a gateway target is touched only at its port */
  tMiddle: boolean;
}

/** Consecutive segments of one line going one way on one grid line. */
interface Run {
  a: Point;
  b: Point;
  kind: Seg['kind'];
  segs: number[];
}

interface Found {
  points: Point[];
  cost: number;
}

interface Score {
  hits: number;
  penalty: number;
}

interface Attempt extends Found {
  hits: number;
}

/**
 * Orthogonal routing of one connection, pure geometry: A* over a Hanan grid near the ends,
 * retried over the whole plane when the route still cuts an obstacle. Minimises length,
 * 150 per bend, 200 per crossing and 300 per collinear overlap; independent of input order.
 */
export class OrthogonalRouter {
  private constructor(private readonly c: Ctx) {}

  static route(req: RouteRequest): Point[] {
    const c = OrthogonalRouter.context(req);
    const router = new OrthogonalRouter(c);
    const frame = req.frame && OrthogonalRouter.finiteBox(req.frame) ? union(req.frame, union(c.s, c.t)) : undefined;
    let best = router.attempt(false, frame);
    if (!best || best.hits > 0) best = OrthogonalRouter.better(best, router.attempt(true, frame));
    // gaps narrower than two margins have no grid line: look again with a thin margin
    const thin = c.m > THIN_MARGIN ? new OrthogonalRouter({ ...c, m: THIN_MARGIN }) : undefined;
    if (thin && (!best || best.hits > 0)) best = OrthogonalRouter.better(best, thin.attempt(true, frame));
    if (frame && (!best || best.hits > 0)) {
      const free = OrthogonalRouter.better(router.attempt(true, undefined), thin && thin.attempt(true, undefined));
      if (free && free.hits === 0) best = free;
    }
    return router.centreJogs(best ? best.points : router.directRoute());
  }

  private static intersect(a: Box, b: Box): Box {
    const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
    return { x, y, width: Math.max(0, Math.min(right(a), right(b)) - x), height: Math.max(0, Math.min(bottom(a), bottom(b)) - y) };
  }

  private static touches(a: Box, b: Box): boolean {
    return a.x <= right(b) && right(a) >= b.x && a.y <= bottom(b) && bottom(a) >= b.y;
  }

  private static finiteBox(b: Box): boolean {
    return [b.x, b.y, b.width, b.height].every(Number.isFinite) && b.width >= 0 && b.height >= 0;
  }

  private static segmentsOverlap(a: Point, b: Point, c: Point, d: Point): boolean {
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

  private static faces(b: Box, side: Side, other: Box): boolean {
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

  private static stubBlocked(b: Box, side: Side, t: number, stub: number, obstacles: Box[]): boolean {
    const p = pointOn(b, side, t);
    const d = OUTWARD[side];
    const q = { x: p.x + DX[d]! * stub, y: p.y + DY[d]! * stub };
    return obstacles.some((o) => segmentHitsBox(p, q, o));
  }

  /**
   * Per side the middle, a spot giving a straight line to the other box when facing it, and
   * spots beside blockers when the middle is blocked or already docked on.
   */
  private static makePorts(b: Box, sides: Side[], rank: number[], other: Box, obstacles: Box[], m: number, stub: number, docked: Point[] = [], middle = false, avoid: readonly Side[] = []): Port[] {
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
        if (OrthogonalRouter.stubBlocked(b, side, t, stub, obstacles)) return;
        cands.set(t, base + PORT_OFFSET + (PORT_SLOPE * Math.abs(t - mid)) / Math.max(len, 1));
      };
      if (OrthogonalRouter.faces(b, side, other)) {
        const [olo, ohi] = span(other, side);
        add(Math.round(olo + (ohi - olo) / 2));
      }
      const blockers = obstacles.filter((o) => OrthogonalRouter.stubBlocked(b, side, mid, stub, [o]));
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

  private static sidesOf(sides: Side[] | undefined, fallback: Side[]): Side[] {
    const list = (sides ?? []).filter((s, i, all) => all.indexOf(s) === i && s in OUTWARD);
    return list.length ? list : fallback;
  }

  private static runsOf(segs: Seg[], first: number): Run[] {
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
   * Marks as `merge` the shared tail of each line entering a `mergeAt` port vertically: its last
   * run, a short hook with the run before it, and the runs back to where it parts from another.
   */
  private static lineSegments(lines: Point[][], mergeAt: readonly Port[] = [], hook = 0): Seg[] {
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
      const runs = OrthogonalRouter.runsOf(segs, first);
      const last = runs[runs.length - 1];
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
      for (const other of entries) {
        if (other.port !== port || other.runs === runs) continue;
        for (let i = n - 1, j = other.runs.length - 1; i >= 0 && j >= 0; i--, j--) {
          const x = runs[i]!, y = other.runs[j]!;
          if (!OrthogonalRouter.segmentsOverlap(x.a, x.b, y.a, y.b)) break;
          mark(x);
          if (Math.abs(x.a.x - y.a.x) > OVERLAP_TOL || Math.abs(x.a.y - y.a.y) > OVERLAP_TOL) break;
        }
      }
    }
    return segs;
  }

  private static context(req: RouteRequest): Ctx {
    const m = Math.max(0, req.margin ?? 15);
    const stub = Math.max(MIN_STUB, m);
    const s = req.source, t = req.target;
    const obstacles = req.obstacles.filter(OrthogonalRouter.finiteBox);
    const docked = (req.lines ?? []).flatMap((l) => (l.length >= 2 ? [l[0]!, l[l.length - 1]!] : []));
    const tgt = OrthogonalRouter.makePorts(t, OrthogonalRouter.sidesOf(req.targetSides, TARGET_DEFAULT), TGT_RANK, s, obstacles, m, stub, docked, req.targetMiddle === true, req.targetAvoid);
    const mergeAt = req.targetMerge ? tgt.filter((p) => p.side === 'top' || p.side === 'bottom') : [];
    return {
      s,
      t,
      m,
      stub,
      obstacles,
      segs: OrthogonalRouter.lineSegments(req.lines ?? [], mergeAt, t.width + 2 * stub),
      src: OrthogonalRouter.makePorts(s, OrthogonalRouter.sidesOf(req.sourceSides, SOURCE_DEFAULT), SRC_RANK, t, obstacles, m, stub, docked, req.sourceMiddle === true, req.sourceAvoid),
      tgt,
      tMiddle: req.targetMiddle === true,
    };
  }

  /**
   * Source and target plus padding, grown twice by the obstacles touching it so routes can go
   * around them; a route needing more room is found by the whole-plane retry.
   */
  private region(wide: boolean, frame: Box | undefined): Box {
    const spread = 2 * this.c.m + 10;
    const clip = (b: Box): Box => (frame ? OrthogonalRouter.intersect(b, frame) : b);
    let ext = grow(union(this.c.s, this.c.t), Math.max(REGION_PAD, 2 * this.c.stub + 20));
    if (wide) for (const o of this.c.obstacles) ext = union(ext, grow(o, spread));
    ext = clip(ext);
    for (let round = 0; round < 2; round++) {
      let next = ext;
      for (const o of this.c.obstacles) if (OrthogonalRouter.touches(o, ext)) next = union(next, grow(o, spread));
      next = clip(next);
      if (equalBoxes(next, ext)) break;
      ext = next;
    }
    return ext;
  }

  private static sortedUnique(values: number[], lo: number, hi: number): number[] {
    const out: number[] = [];
    for (const v of values.filter((x) => Number.isFinite(x) && x >= lo && x <= hi).sort((a, b) => a - b)) {
      if (!out.length || v - out[out.length - 1]! > EPS) out.push(v);
    }
    return out;
  }

  private gridLines(ext: Box, inc: Box[], frame: Box | undefined): { xs: number[]; ys: number[] } {
    const xs: number[] = [], ys: number[] = [];
    for (const p of [...this.c.src, ...this.c.tgt]) {
      xs.push(p.x);
      ys.push(p.y);
    }
    for (const seg of this.c.segs) {
      if (seg.merge && seg.kind === 'v') xs.push(seg.a.x);
      if (seg.merge && seg.kind === 'h') ys.push(seg.a.y);
    }
    for (const b of [this.c.s, this.c.t]) {
      xs.push(b.x - this.c.stub, right(b) + this.c.stub);
      ys.push(b.y - this.c.stub, bottom(b) + this.c.stub);
    }
    const { s, t } = this.c;
    if (t.x > right(s)) xs.push(Math.round((right(s) + t.x) / 2));
    if (s.x > right(t)) xs.push(Math.round((right(t) + s.x) / 2));
    if (t.y > bottom(s)) ys.push(Math.round((bottom(s) + t.y) / 2));
    if (s.y > bottom(t)) ys.push(Math.round((bottom(t) + s.y) / 2));
    for (const o of inc) {
      xs.push(o.x - this.c.m, right(o) + this.c.m);
      ys.push(o.y - this.c.m, bottom(o) + this.c.m);
    }
    if (frame) {
      const ix = Math.round(Math.min(this.c.m, frame.width / 2)), iy = Math.round(Math.min(this.c.m, frame.height / 2));
      xs.push(frame.x + ix, right(frame) - ix);
      ys.push(frame.y + iy, bottom(frame) - iy);
    }
    return { xs: OrthogonalRouter.sortedUnique(xs, ext.x, right(ext)), ys: OrthogonalRouter.sortedUnique(ys, ext.y, bottom(ext)) };
  }

  private buildGrid(ext: Box, frame: Box | undefined): RouteGrid {
    const inc = this.c.obstacles.filter((o) => OrthogonalRouter.touches(o, ext));
    const { xs, ys } = this.gridLines(ext, inc, frame);
    const nx = xs.length, ny = ys.length;
    const g = new RouteGrid(xs, ys);
    for (let j = 0; j < ny; j++) for (let i = 0; i + 1 < nx; i++) g.hCost[j * (nx - 1) + i] = xs[i + 1]! - xs[i]!;
    for (let j = 0; j + 1 < ny; j++) for (let i = 0; i < nx; i++) g.vCost[j * nx + i] = ys[j + 1]! - ys[j]!;
    for (const o of inc) {
      g.addInside(o, HIT, 0);
      g.addOutline(o, OVERLAP);
      if (this.c.m > 0) g.addInside(grow(o, this.c.m), 0, NEAR);
    }
    g.addInside(this.c.s, HIT, 0);
    g.addInside(this.c.t, HIT, 0);
    if (this.c.tMiddle) g.guardVertices(this.c.t);
    const near = grow(ext, OVERLAP_TOL + 1);
    for (const seg of this.c.segs) {
      const bb = { x: Math.min(seg.a.x, seg.b.x), y: Math.min(seg.a.y, seg.b.y), width: Math.abs(seg.a.x - seg.b.x), height: Math.abs(seg.a.y - seg.b.y) };
      if (OrthogonalRouter.touches(bb, near)) g.markLine(seg);
    }
    g.anyOv = g.hOv.some((v) => v === 1) || g.vOv.some((v) => v === 1);
    g.anyMg = g.hMg.some((v) => v === 1) || g.vMg.some((v) => v === 1);
    g.markStubZones(this.c.s, this.c.stub);
    g.markStubZones(this.c.t, this.c.stub);
    return g;
  }

  /**
   * A* over (node, direction, run: 0 free, 1 overlap, 2 shared tail) states. The heuristic adds
   * the unavoidable bends to the Manhattan distance and stays consistent, so the first goal
   * popped is optimal.
   */
  private astar(g: RouteGrid): Found | undefined {
    const { xs, ys, nx, ny } = g;
    if (!nx || !ny) return undefined;
    const nOv = g.anyMg ? 3 : g.anyOv ? 2 : 1;

    const goalNode = new Uint8Array(nx * ny);
    const goals = new Map<number, number>(); // node·4 + inward direction -> port cost
    const tx: number[] = [], ty: number[] = [], te: number[] = [];
    for (const p of this.c.tgt) {
      const node = g.nodeOf(p);
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
    const heap = new SearchHeap();
    for (const p of this.c.src) {
      const node = g.nodeOf(p);
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
      if (!start && goalNode[node] && goals.has(nd4)) return { points: g.trace(st, parent, nOv), cost: cg };
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

  private score(points: Point[]): Score {
    let hits = 0, penalty = 0;
    const boxes = [...this.c.obstacles, this.c.s, this.c.t];
    const onTail = (k: number): boolean => this.c.segs.some((seg) => seg.merge && OrthogonalRouter.segmentsOverlap(points[k]!, points[k + 1]!, seg.a, seg.b));
    let tail = points.length - 1;
    while (tail > 0 && onTail(tail - 1)) tail--;
    for (let i = 0; i + 1 < points.length; i++) {
      const a = points[i]!, b = points[i + 1]!;
      for (const box of boxes) if (segmentHitsBox(a, b, box)) hits++;
      for (const seg of this.c.segs) {
        if (segmentsCross(a, b, seg.a, seg.b)) penalty += CROSS;
        else if ((!seg.merge || i < tail) && OrthogonalRouter.segmentsOverlap(a, b, seg.a, seg.b)) penalty += OVERLAP;
      }
    }
    return { hits, penalty };
  }

  private attempt(wide: boolean, frame: Box | undefined): Attempt | undefined {
    const found = this.astar(this.buildGrid(this.region(wide, frame), frame));
    return found && { ...found, hits: this.score(found.points).hits };
  }

  private static better(a: Attempt | undefined, b: Attempt | undefined): Attempt | undefined {
    if (!a || !b) return a ?? b;
    return b.hits < a.hits || (b.hits === a.hits && b.cost < a.cost) ? b : a;
  }

  /** Only when the search finds nothing. */
  private directRoute(): Point[] {
    const p = this.c.src[0] ?? { ...pointOn(this.c.s, 'right', this.c.s.y + this.c.s.height / 2), side: 'right' as Side, cost: 0 };
    const q = this.c.tgt[0] ?? { ...pointOn(this.c.t, 'left', this.c.t.y + this.c.t.height / 2), side: 'left' as Side, cost: 0 };
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

  /** Centres the middle segment of a Z in its free channel, kept only when it costs nothing. */
  private centreJog(p: Point[], k: number): Point[] | undefined {
    const a = p[k - 1]!, b = p[k]!, q = p[k + 1]!, d = p[k + 2]!;
    const vertical = b.x === q.x;
    if (vertical ? a.y !== b.y || q.y !== d.y : a.x !== b.x || q.x !== d.x) return undefined;
    const along = (pt: Point): number => (vertical ? pt.x : pt.y);
    const dir = Math.sign(along(b) - along(a));
    if (dir === 0 || dir !== Math.sign(along(d) - along(q))) return undefined;
    const from = along(a) + (k === 1 ? dir * this.c.stub : 0);
    const to = along(d) - (k + 2 === p.length - 1 ? dir * this.c.stub : 0);
    if (dir * (to - from) < 0) return undefined;
    let lo = Math.min(from, to), hi = Math.max(from, to);
    const at = along(b);
    const s1 = Math.min(vertical ? b.y : b.x, vertical ? q.y : q.x);
    const s2 = Math.max(vertical ? b.y : b.x, vertical ? q.y : q.x);
    const blockers = [...this.c.obstacles.map((o) => grow(o, this.c.m)), grow(this.c.s, this.c.stub), grow(this.c.t, this.c.stub)];
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
    const before = this.score(p), after = this.score(moved);
    return after.hits <= before.hits && after.penalty <= before.penalty ? moved : undefined;
  }

  private centreJogs(points: Point[]): Point[] {
    let out = points;
    for (let k = 1; k + 2 < out.length; k++) out = this.centreJog(out, k) ?? out;
    return simplify(out);
  }
}
