import { bottom, cy, equalBoxes, grow, right, segmentHitsBox, union } from '../../drawing/utils/geom.js';
import type { Box, Point, Side } from '../../drawing/types.js';
import { SOURCE_DEFAULT, TARGET_DEFAULT } from '../../drawing/utils/sides.js';
import { RouteGrid } from './RouteGrid.js';
import { SearchHeap } from './SearchHeap.js';
import { AVOID, BEND, CROSS, DX, DY, EPS, HIT, MIN_STUB, NEAR, OUTWARD, OVERLAP, OVERLAP_TOL, PORT_OFFSET, PORT_SLOPE, REGION_PAD, SRC_RANK, TGT_RANK, THIN_MARGIN, pointOn, segmentsCross, simplify, span, type Port, type Seg } from '../../drawing/utils/routing.js';

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
  source: Box;
  target: Box;
  margin: number;
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
  start: Point;
  end: Point;
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
  private constructor(private readonly context: Ctx) {}

  static route(req: RouteRequest): Point[] {
    const context = OrthogonalRouter.context(req);
    const router = new OrthogonalRouter(context);
    const frame = req.frame && OrthogonalRouter.finiteBox(req.frame) ? union(req.frame, union(context.source, context.target)) : undefined;
    let best = router.attempt(false, frame);
    if (!best || best.hits > 0) best = OrthogonalRouter.better(best, router.attempt(true, frame));
    // gaps narrower than two margins have no grid line: look again with a thin margin
    const thin = context.margin > THIN_MARGIN ? new OrthogonalRouter({ ...context, margin: THIN_MARGIN }) : undefined;
    if (thin && (!best || best.hits > 0)) best = OrthogonalRouter.better(best, thin.attempt(true, frame));
    if (frame && (!best || best.hits > 0)) {
      const free = OrthogonalRouter.better(router.attempt(true, undefined), thin && thin.attempt(true, undefined));
      if (free && free.hits === 0) best = free;
    }
    return router.centreJogs(best ? best.points : router.directRoute());
  }

  private static intersect(first: Box, second: Box): Box {
    const left = Math.max(first.x, second.x), top = Math.max(first.y, second.y);
    return { x: left, y: top, width: Math.max(0, Math.min(right(first), right(second)) - left), height: Math.max(0, Math.min(bottom(first), bottom(second)) - top) };
  }

  private static touches(first: Box, second: Box): boolean {
    return first.x <= right(second) && right(first) >= second.x && first.y <= bottom(second) && bottom(first) >= second.y;
  }

  private static finiteBox(box: Box): boolean {
    return [box.x, box.y, box.width, box.height].every(Number.isFinite) && box.width >= 0 && box.height >= 0;
  }

  private static segmentsOverlap(firstStart: Point, firstEnd: Point, secondStart: Point, secondEnd: Point): boolean {
    if (firstStart.y === firstEnd.y && Math.abs(secondStart.y - secondEnd.y) < EPS) {
      if (Math.abs(firstStart.y - secondStart.y) > OVERLAP_TOL) return false;
      return Math.min(Math.max(firstStart.x, firstEnd.x), Math.max(secondStart.x, secondEnd.x)) - Math.max(Math.min(firstStart.x, firstEnd.x), Math.min(secondStart.x, secondEnd.x)) > 1;
    }
    if (firstStart.x === firstEnd.x && Math.abs(secondStart.x - secondEnd.x) < EPS) {
      if (Math.abs(firstStart.x - secondStart.x) > OVERLAP_TOL) return false;
      return Math.min(Math.max(firstStart.y, firstEnd.y), Math.max(secondStart.y, secondEnd.y)) - Math.max(Math.min(firstStart.y, firstEnd.y), Math.min(secondStart.y, secondEnd.y)) > 1;
    }
    return false;
  }

  private static faces(box: Box, side: Side, other: Box): boolean {
    switch (side) {
      case 'left':
        return right(other) <= box.x;
      case 'right':
        return other.x >= right(box);
      case 'top':
        return bottom(other) <= box.y;
      case 'bottom':
        return other.y >= bottom(box);
    }
  }

  private static stubBlocked(box: Box, side: Side, offset: number, stub: number, obstacles: Box[]): boolean {
    const foot = pointOn(box, side, offset);
    const outward = OUTWARD[side];
    const stubEnd = { x: foot.x + DX[outward]! * stub, y: foot.y + DY[outward]! * stub };
    return obstacles.some((obstacle) => segmentHitsBox(foot, stubEnd, obstacle));
  }

  /**
   * Per side the middle, a spot giving a straight line to the other box when facing it, and
   * spots beside blockers when the middle is blocked or already docked on.
   */
  private static makePorts(box: Box, sides: Side[], rank: number[], other: Box, obstacles: Box[], margin: number, stub: number, docked: Point[] = [], middle = false, avoid: readonly Side[] = []): Port[] {
    const ports: Port[] = [];
    sides.forEach((side, sideIndex) => {
      const base = rank[Math.min(sideIndex, rank.length - 1)]! + (avoid.includes(side) ? AVOID : 0);
      const [lo, hi] = span(box, side);
      const len = hi - lo;
      const mid = Math.round(lo + len / 2);
      const inset = Math.min(10, len / 4);
      const cands = new Map<number, number>([[mid, base]]);
      const add = (offset: number, clamp = false): void => {
        if (middle) return;
        if (clamp) offset = Math.round(Math.min(hi - inset, Math.max(lo + inset, offset)));
        if (offset < lo + inset || offset > hi - inset || cands.has(offset)) return;
        if (OrthogonalRouter.stubBlocked(box, side, offset, stub, obstacles)) return;
        cands.set(offset, base + PORT_OFFSET + (PORT_SLOPE * Math.abs(offset - mid)) / Math.max(len, 1));
      };
      if (OrthogonalRouter.faces(box, side, other)) {
        const [olo, ohi] = span(other, side);
        add(Math.round(olo + (ohi - olo) / 2));
      }
      const blockers = obstacles.filter((obstacle) => OrthogonalRouter.stubBlocked(box, side, mid, stub, [obstacle]));
      for (const obstacle of blockers) {
        const [olo, ohi] = span(obstacle, side);
        add(olo - margin, true);
        add(ohi + margin, true);
      }
      const taken = docked.some((dockPoint) => {
        const middlePoint = pointOn(box, side, mid);
        return Math.abs(dockPoint.x - middlePoint.x) <= 2 && Math.abs(dockPoint.y - middlePoint.y) <= 2;
      });
      if (blockers.length || taken) {
        add(Math.round(lo + len / 4));
        add(Math.round(lo + (3 * len) / 4));
      }
      for (const [offset, cost] of [...cands].sort((first, second) => first[0] - second[0])) ports.push({ ...pointOn(box, side, offset), side, cost });
    });
    return ports;
  }

  private static sidesOf(sides: Side[] | undefined, fallback: Side[]): Side[] {
    const list = (sides ?? []).filter((side, index, all) => all.indexOf(side) === index && side in OUTWARD);
    return list.length ? list : fallback;
  }

  private static runsOf(segs: Seg[], first: number): Run[] {
    const out: Run[] = [];
    const way = (from: Point, to: Point): string => `${Math.sign(to.x - from.x)},${Math.sign(to.y - from.y)}`;
    for (let segIndex = first; segIndex < segs.length; segIndex++) {
      const { start, end, kind } = segs[segIndex]!;
      const last = out[out.length - 1];
      if (last && kind !== 'd' && kind === last.kind && (kind === 'v' ? Math.abs(start.x - last.start.x) : Math.abs(start.y - last.start.y)) < EPS && way(start, end) === way(last.start, last.end)) {
        last.end = end;
        last.segs.push(segIndex);
      } else out.push({ start, end, kind, segs: [segIndex] });
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
      for (let index = 0; index + 1 < line.length; index++) {
        const start = line[index]!, end = line[index + 1]!;
        if (![start.x, start.y, end.x, end.y].every(Number.isFinite)) continue;
        const dx = Math.abs(start.x - end.x), dy = Math.abs(start.y - end.y);
        if (dx < EPS && dy < EPS) continue;
        const kind = dy < EPS ? 'h' : dx < EPS ? 'v' : 'd';
        const ends = kind === 'd' ? [] : [...(index === 0 ? [start] : []), ...(index + 2 === line.length ? [end] : [])];
        segs.push({ start, end, kind, ...(ends.length ? { ends } : {}) });
      }
      const end = line[line.length - 1];
      const port = end && mergeAt.find((candidate) => Math.abs(candidate.x - end.x) <= OVERLAP_TOL && Math.abs(candidate.y - end.y) <= OVERLAP_TOL);
      if (!port) continue;
      const runs = OrthogonalRouter.runsOf(segs, first);
      const last = runs[runs.length - 1];
      if (last?.kind === 'v' && (port.side === 'bottom' ? last.start.y > last.end.y : last.start.y < last.end.y)) entries.push({ port, runs });
    }
    const mark = (run: Run | undefined): void => {
      for (const segIndex of run?.segs ?? []) segs[segIndex]!.merge = true;
    };
    for (const { port, runs } of entries) {
      const runCount = runs.length;
      mark(runs[runCount - 1]);
      const hookRun = runs[runCount - 2];
      if (hookRun?.kind === 'h' && Math.abs(hookRun.start.x - hookRun.end.x) <= hook) {
        mark(hookRun);
        mark(runs[runCount - 3]);
      }
      for (const other of entries) {
        if (other.port !== port || other.runs === runs) continue;
        for (let index = runCount - 1, otherIndex = other.runs.length - 1; index >= 0 && otherIndex >= 0; index--, otherIndex--) {
          const ownRun = runs[index]!, otherRun = other.runs[otherIndex]!;
          if (!OrthogonalRouter.segmentsOverlap(ownRun.start, ownRun.end, otherRun.start, otherRun.end)) break;
          mark(ownRun);
          if (Math.abs(ownRun.start.x - otherRun.start.x) > OVERLAP_TOL || Math.abs(ownRun.start.y - otherRun.start.y) > OVERLAP_TOL) break;
        }
      }
    }
    return segs;
  }

  private static context(req: RouteRequest): Ctx {
    const margin = Math.max(0, req.margin ?? 15);
    const stub = Math.max(MIN_STUB, margin);
    const source = req.source, target = req.target;
    const obstacles = req.obstacles.filter(OrthogonalRouter.finiteBox);
    const docked = (req.lines ?? []).flatMap((line) => (line.length >= 2 ? [line[0]!, line[line.length - 1]!] : []));
    const tgt = OrthogonalRouter.makePorts(target, OrthogonalRouter.sidesOf(req.targetSides, TARGET_DEFAULT), TGT_RANK, source, obstacles, margin, stub, docked, req.targetMiddle === true, req.targetAvoid);
    const mergeAt = req.targetMerge ? tgt.filter((port) => port.side === 'top' || port.side === 'bottom') : [];
    return {
      source,
      target,
      margin,
      stub,
      obstacles,
      segs: OrthogonalRouter.lineSegments(req.lines ?? [], mergeAt, target.width + 2 * stub),
      src: OrthogonalRouter.makePorts(source, OrthogonalRouter.sidesOf(req.sourceSides, SOURCE_DEFAULT), SRC_RANK, target, obstacles, margin, stub, docked, req.sourceMiddle === true, req.sourceAvoid),
      tgt,
      tMiddle: req.targetMiddle === true,
    };
  }

  /**
   * Source and target plus padding, grown twice by the obstacles touching it so routes can go
   * around them; a route needing more room is found by the whole-plane retry.
   */
  private region(wide: boolean, frame: Box | undefined): Box {
    const spread = 2 * this.context.margin + 10;
    const clip = (box: Box): Box => (frame ? OrthogonalRouter.intersect(box, frame) : box);
    let ext = grow(union(this.context.source, this.context.target), Math.max(REGION_PAD, 2 * this.context.stub + 20));
    if (wide) for (const obstacle of this.context.obstacles) ext = union(ext, grow(obstacle, spread));
    ext = clip(ext);
    for (let round = 0; round < 2; round++) {
      let next = ext;
      for (const obstacle of this.context.obstacles) if (OrthogonalRouter.touches(obstacle, ext)) next = union(next, grow(obstacle, spread));
      next = clip(next);
      if (equalBoxes(next, ext)) break;
      ext = next;
    }
    return ext;
  }

  private static sortedUnique(values: number[], lo: number, hi: number): number[] {
    const out: number[] = [];
    for (const value of values.filter((candidate) => Number.isFinite(candidate) && candidate >= lo && candidate <= hi).sort((first, second) => first - second)) {
      if (!out.length || value - out[out.length - 1]! > EPS) out.push(value);
    }
    return out;
  }

  private gridLines(ext: Box, inc: Box[], frame: Box | undefined): { xs: number[]; ys: number[] } {
    const xs: number[] = [], ys: number[] = [];
    for (const port of [...this.context.src, ...this.context.tgt]) {
      xs.push(port.x);
      ys.push(port.y);
    }
    for (const seg of this.context.segs) {
      if (seg.merge && seg.kind === 'v') xs.push(seg.start.x);
      if (seg.merge && seg.kind === 'h') ys.push(seg.start.y);
    }
    for (const box of [this.context.source, this.context.target]) {
      xs.push(box.x - this.context.stub, right(box) + this.context.stub);
      ys.push(box.y - this.context.stub, bottom(box) + this.context.stub);
    }
    const { source, target } = this.context;
    if (target.x > right(source)) xs.push(Math.round((right(source) + target.x) / 2));
    if (source.x > right(target)) xs.push(Math.round((right(target) + source.x) / 2));
    if (target.y > bottom(source)) ys.push(Math.round((bottom(source) + target.y) / 2));
    if (source.y > bottom(target)) ys.push(Math.round((bottom(target) + source.y) / 2));
    for (const obstacle of inc) {
      xs.push(obstacle.x - this.context.margin, right(obstacle) + this.context.margin);
      ys.push(obstacle.y - this.context.margin, bottom(obstacle) + this.context.margin);
    }
    if (frame) {
      const ix = Math.round(Math.min(this.context.margin, frame.width / 2)), iy = Math.round(Math.min(this.context.margin, frame.height / 2));
      xs.push(frame.x + ix, right(frame) - ix);
      ys.push(frame.y + iy, bottom(frame) - iy);
    }
    return { xs: OrthogonalRouter.sortedUnique(xs, ext.x, right(ext)), ys: OrthogonalRouter.sortedUnique(ys, ext.y, bottom(ext)) };
  }

  private buildGrid(ext: Box, frame: Box | undefined): RouteGrid {
    const inc = this.context.obstacles.filter((obstacle) => OrthogonalRouter.touches(obstacle, ext));
    const { xs, ys } = this.gridLines(ext, inc, frame);
    const nx = xs.length, ny = ys.length;
    const grid = new RouteGrid(xs, ys);
    for (let row = 0; row < ny; row++) for (let column = 0; column + 1 < nx; column++) grid.hCost[row * (nx - 1) + column] = xs[column + 1]! - xs[column]!;
    for (let row = 0; row + 1 < ny; row++) for (let column = 0; column < nx; column++) grid.vCost[row * nx + column] = ys[row + 1]! - ys[row]!;
    for (const obstacle of inc) {
      grid.addInside(obstacle, HIT, 0);
      grid.addOutline(obstacle, OVERLAP);
      if (this.context.margin > 0) grid.addInside(grow(obstacle, this.context.margin), 0, NEAR);
    }
    grid.addInside(this.context.source, HIT, 0);
    grid.addInside(this.context.target, HIT, 0);
    if (this.context.tMiddle) grid.guardVertices(this.context.target);
    const near = grow(ext, OVERLAP_TOL + 1);
    for (const seg of this.context.segs) {
      const bb = { x: Math.min(seg.start.x, seg.end.x), y: Math.min(seg.start.y, seg.end.y), width: Math.abs(seg.start.x - seg.end.x), height: Math.abs(seg.start.y - seg.end.y) };
      if (OrthogonalRouter.touches(bb, near)) grid.markLine(seg);
    }
    grid.anyOv = grid.hOv.some((flag) => flag === 1) || grid.vOv.some((flag) => flag === 1);
    grid.anyMg = grid.hMg.some((flag) => flag === 1) || grid.vMg.some((flag) => flag === 1);
    grid.markStubZones(this.context.source, this.context.stub);
    grid.markStubZones(this.context.target, this.context.stub);
    return grid;
  }

  /**
   * A* over (node, direction, run: 0 free, 1 overlap, 2 shared tail) states. The heuristic adds
   * the unavoidable bends to the Manhattan distance and stays consistent, so the first goal
   * popped is optimal.
   */
  private astar(grid: RouteGrid): Found | undefined {
    const { xs, ys, nx, ny } = grid;
    if (!nx || !ny) return undefined;
    const nOv = grid.anyMg ? 3 : grid.anyOv ? 2 : 1;

    const goalNode = new Uint8Array(nx * ny);
    const goals = new Map<number, number>(); // node·4 + inward direction -> port cost
    const tx: number[] = [], ty: number[] = [], te: number[] = [];
    for (const port of this.context.tgt) {
      const node = grid.nodeOf(port);
      if (node === undefined) continue;
      const inward = (OUTWARD[port.side] + 2) % 4;
      const key = node * 4 + inward;
      if (!goals.has(key) || goals.get(key)! > port.cost) goals.set(key, port.cost);
      goalNode[node] = 1;
      tx.push(port.x);
      ty.push(port.y);
      te.push(inward);
    }
    if (!tx.length) return undefined;
    const heuristic = (node: number, dir: number): number => {
      const nodeX = xs[node % nx]!, nodeY = ys[Math.floor(node / nx)]!;
      let best = Infinity;
      for (let targetIndex = 0; targetIndex < tx.length; targetIndex++) {
        const qx = tx[targetIndex]!, qy = ty[targetIndex]!, inward = te[targetIndex]!;
        let bends: number;
        if (dir === inward) {
          const ahead = inward === 0 ? nodeY === qy && qx >= nodeX : inward === 2 ? nodeY === qy && qx <= nodeX : inward === 1 ? nodeX === qx && qy >= nodeY : nodeX === qx && qy <= nodeY;
          bends = ahead ? 0 : 2;
        } else bends = dir === (inward + 2) % 4 ? 2 : 1;
        const estimate = Math.abs(nodeX - qx) + Math.abs(nodeY - qy) + BEND * bends;
        if (estimate < best) best = estimate;
      }
      return best;
    };

    const gs = new Float64Array(nx * ny * 4 * nOv).fill(Infinity);
    const parent = new Int32Array(gs.length).fill(-2);
    const heap = new SearchHeap();
    for (const port of this.context.src) {
      const node = grid.nodeOf(port);
      if (node === undefined) continue;
      const dir = OUTWARD[port.side];
      const st = node * 4 * nOv + dir * nOv;
      if (port.cost >= gs[st]!) continue;
      gs[st] = port.cost;
      parent[st] = -1;
      heap.push(st, port.cost, heuristic(node, dir));
    }

    while (heap.size) {
      const id = heap.pop();
      const st = heap.state[id]!, cg = heap.cost[id]!;
      if (cg > gs[st]!) continue;
      const ov = st % nOv;
      const nd4 = (st - ov) / nOv;
      const dir = nd4 % 4;
      const node = (nd4 - dir) / 4;
      const start = parent[st] === -1;
      if (!start && goalNode[node] && goals.has(nd4)) return { points: grid.trace(st, parent, nOv), cost: cg };
      const column = node % nx, row = (node - column) / nx;
      for (let turnIndex = 0; turnIndex < (start ? 1 : 3); turnIndex++) {
        const direction = turnIndex === 0 ? dir : turnIndex === 1 ? (dir + 1) % 4 : (dir + 3) % 4;
        const ni = column + DX[direction]!, nj = row + DY[direction]!;
        if (ni < 0 || nj < 0 || ni >= nx || nj >= ny) continue;
        let cost: number, ovEdge: number, mgEdge: number;
        if (direction === 0 || direction === 2) {
          const edge = row * (nx - 1) + (direction === 0 ? column : column - 1);
          cost = grid.hCost[edge]!;
          ovEdge = grid.hOv[edge]!;
          mgEdge = grid.hMg[edge]!;
        } else {
          const edge = (direction === 1 ? row : row - 1) * nx + column;
          cost = grid.vCost[edge]!;
          ovEdge = grid.vOv[edge]!;
          mgEdge = grid.vMg[edge]!;
        }
        let ng = cg + cost;
        if (direction !== dir) ng += BEND + grid.turn[node]!;
        let nov = 0;
        if (ovEdge) {
          nov = 1;
          if (!(ov === 1 && direction === dir)) ng += OVERLAP;
        } else if (mgEdge) nov = 2;
        // a shared tail left before the vertex was an overlap after all
        if (ov === 2 && nov !== 2) ng += OVERLAP;
        const nn = nj * nx + ni;
        const goalCost = goalNode[nn] ? goals.get(nn * 4 + direction) : undefined;
        if (goalCost !== undefined) ng += goalCost;
        const ns = (nn * 4 + direction) * nOv + nov;
        if (ng < gs[ns]!) {
          gs[ns] = ng;
          parent[ns] = st;
          heap.push(ns, ng, goalCost !== undefined ? 0 : heuristic(nn, direction));
        }
      }
    }
    return undefined;
  }

  private score(points: Point[]): Score {
    let hits = 0, penalty = 0;
    const boxes = [...this.context.obstacles, this.context.source, this.context.target];
    const onTail = (segmentIndex: number): boolean => this.context.segs.some((seg) => seg.merge && OrthogonalRouter.segmentsOverlap(points[segmentIndex]!, points[segmentIndex + 1]!, seg.start, seg.end));
    let tail = points.length - 1;
    while (tail > 0 && onTail(tail - 1)) tail--;
    for (let index = 0; index + 1 < points.length; index++) {
      const start = points[index]!, end = points[index + 1]!;
      for (const box of boxes) if (segmentHitsBox(start, end, box)) hits++;
      for (const seg of this.context.segs) {
        if (segmentsCross(start, end, seg.start, seg.end)) penalty += CROSS;
        else if ((!seg.merge || index < tail) && OrthogonalRouter.segmentsOverlap(start, end, seg.start, seg.end)) penalty += OVERLAP;
      }
    }
    return { hits, penalty };
  }

  private attempt(wide: boolean, frame: Box | undefined): Attempt | undefined {
    const found = this.astar(this.buildGrid(this.region(wide, frame), frame));
    return found && { ...found, hits: this.score(found.points).hits };
  }

  private static better(first: Attempt | undefined, second: Attempt | undefined): Attempt | undefined {
    if (!first || !second) return first ?? second;
    return second.hits < first.hits || (second.hits === first.hits && second.cost < first.cost) ? second : first;
  }

  /** Only when the search finds nothing. */
  private directRoute(): Point[] {
    const sourcePort = this.context.src[0] ?? { ...pointOn(this.context.source, 'right', cy(this.context.source)), side: 'right' as Side, cost: 0 };
    const targetPort = this.context.tgt[0] ?? { ...pointOn(this.context.target, 'left', cy(this.context.target)), side: 'left' as Side, cost: 0 };
    const start = { x: sourcePort.x, y: sourcePort.y }, end = { x: targetPort.x, y: targetPort.y };
    if (start.x === end.x || start.y === end.y) return simplify([start, end]);
    const hp = sourcePort.side === 'left' || sourcePort.side === 'right';
    const hq = targetPort.side === 'left' || targetPort.side === 'right';
    if (hp && hq) {
      const mx = Math.round((start.x + end.x) / 2);
      return simplify([start, { x: mx, y: start.y }, { x: mx, y: end.y }, end]);
    }
    if (!hp && !hq) {
      const my = Math.round((start.y + end.y) / 2);
      return simplify([start, { x: start.x, y: my }, { x: end.x, y: my }, end]);
    }
    return simplify(hp ? [start, { x: end.x, y: start.y }, end] : [start, { x: start.x, y: end.y }, end]);
  }

  /** Centres the middle segment of a Z in its free channel, kept only when it costs nothing. */
  private centreJog(points: Point[], index: number): Point[] | undefined {
    const previous = points[index - 1]!, jogStart = points[index]!, jogEnd = points[index + 1]!, next = points[index + 2]!;
    const vertical = jogStart.x === jogEnd.x;
    if (vertical ? previous.y !== jogStart.y || jogEnd.y !== next.y : previous.x !== jogStart.x || jogEnd.x !== next.x) return undefined;
    const along = (pt: Point): number => (vertical ? pt.x : pt.y);
    const dir = Math.sign(along(jogStart) - along(previous));
    if (dir === 0 || dir !== Math.sign(along(next) - along(jogEnd))) return undefined;
    const from = along(previous) + (index === 1 ? dir * this.context.stub : 0);
    const to = along(next) - (index + 2 === points.length - 1 ? dir * this.context.stub : 0);
    if (dir * (to - from) < 0) return undefined;
    let lo = Math.min(from, to), hi = Math.max(from, to);
    const at = along(jogStart);
    const s1 = Math.min(vertical ? jogStart.y : jogStart.x, vertical ? jogEnd.y : jogEnd.x);
    const s2 = Math.max(vertical ? jogStart.y : jogStart.x, vertical ? jogEnd.y : jogEnd.x);
    const blockers = [...this.context.obstacles.map((blocker) => grow(blocker, this.context.margin)), grow(this.context.source, this.context.stub), grow(this.context.target, this.context.stub)];
    for (const blocker of blockers) {
      const olo = vertical ? blocker.x : blocker.y, ohi = vertical ? right(blocker) : bottom(blocker);
      const clo = vertical ? blocker.y : blocker.x, chi = vertical ? bottom(blocker) : right(blocker);
      if (chi < s1 || clo > s2) continue;
      if (ohi <= at) lo = Math.max(lo, ohi);
      else if (olo >= at) hi = Math.min(hi, olo);
      else return undefined;
    }
    if (hi < lo) return undefined;
    const centre = Math.round((lo + hi) / 2);
    if (Math.abs(centre - at) < 1) return undefined;
    const moved = points.map((pt) => ({ ...pt }));
    if (vertical) {
      moved[index]!.x = centre;
      moved[index + 1]!.x = centre;
    } else {
      moved[index]!.y = centre;
      moved[index + 1]!.y = centre;
    }
    const before = this.score(points), after = this.score(moved);
    return after.hits <= before.hits && after.penalty <= before.penalty ? moved : undefined;
  }

  private centreJogs(points: Point[]): Point[] {
    let out = points;
    for (let index = 1; index + 2 < out.length; index++) out = this.centreJog(out, index) ?? out;
    return simplify(out);
  }
}
