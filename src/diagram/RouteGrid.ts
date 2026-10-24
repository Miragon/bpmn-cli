import type { Box, Point } from './types.js';
import { bottom, right } from './utils/geom.js';
import { CROSS, END_ZONE, EPS, HIT, OUTWARD, OVERLAP_TOL, STUB_TURN, pointOn, simplify, span, type Seg } from './utils/routing.js';

export class RouteGrid {
  readonly nx: number;
  readonly ny: number;
  /** static cost of the horizontal edge (i,j)-(i+1,j) at j·(nx-1)+i and the vertical edge (i,j)-(i,j+1) at j·nx+i */
  readonly hCost: Float64Array;
  readonly vCost: Float64Array;
  /** the edge runs on top of an existing line */
  readonly hOv: Uint8Array;
  readonly vOv: Uint8Array;
  anyOv = false;
  /** the edge runs on a shared tail into a join's vertex (targetMerge) and on no other line */
  readonly hMg: Uint8Array;
  readonly vMg: Uint8Array;
  anyMg = false;
  /** extra cost for turning at a node (stub zones of source and target) */
  readonly turn: Float64Array;

  constructor(
    readonly xs: number[],
    readonly ys: number[],
  ) {
    const nx = xs.length, ny = ys.length;
    this.nx = nx;
    this.ny = ny;
    this.hCost = new Float64Array(Math.max(0, nx - 1) * ny);
    this.vCost = new Float64Array(nx * Math.max(0, ny - 1));
    this.hOv = new Uint8Array(Math.max(0, nx - 1) * ny);
    this.vOv = new Uint8Array(nx * Math.max(0, ny - 1));
    this.hMg = new Uint8Array(Math.max(0, nx - 1) * ny);
    this.vMg = new Uint8Array(nx * Math.max(0, ny - 1));
    this.turn = new Float64Array(nx * ny);
  }

  /** first index k with arr[k] > v */
  private static upper(arr: number[], v: number): number {
    let lo = 0, hi = arr.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid]! > v) hi = mid;
      else lo = mid + 1;
    }
    return lo;
  }

  /** first index k with arr[k] >= v */
  private static lower(arr: number[], v: number): number {
    let lo = 0, hi = arr.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid]! >= v) hi = mid;
      else lo = mid + 1;
    }
    return lo;
  }

  private static bump(arr: Float64Array, i: number, v: number): void {
    arr[i] = arr[i]! + v;
  }

  /** add `perEdge + perPx·length` to every grid edge running through the open interior of `b` */
  addInside(b: Box, perEdge: number, perPx: number): void {
    const { xs, ys, nx, ny } = this;
    for (let j = RouteGrid.upper(ys, b.y); j < ny && ys[j]! < bottom(b); j++) {
      for (let i = Math.max(0, RouteGrid.upper(xs, b.x) - 1); i < nx - 1 && xs[i]! < right(b); i++) {
        RouteGrid.bump(this.hCost, j * (nx - 1) + i, perEdge + perPx * (xs[i + 1]! - xs[i]!));
      }
    }
    for (let i = RouteGrid.upper(xs, b.x); i < nx && xs[i]! < right(b); i++) {
      for (let j = Math.max(0, RouteGrid.upper(ys, b.y) - 1); j < ny - 1 && ys[j]! < bottom(b); j++) {
        RouteGrid.bump(this.vCost, j * nx + i, perEdge + perPx * (ys[j + 1]! - ys[j]!));
      }
    }
  }

  /** add `cost` to every grid edge lying on the outline of `b` (a connection drawn along a shape's border) */
  addOutline(b: Box, cost: number): void {
    const { xs, ys, nx, ny } = this;
    for (const y of [b.y, bottom(b)]) {
      const j = RouteGrid.lower(ys, y - EPS);
      if (j >= ny || Math.abs(ys[j]! - y) > EPS) continue;
      for (let i = Math.max(0, RouteGrid.upper(xs, b.x) - 1); i < nx - 1 && xs[i]! < right(b); i++) {
        if (Math.min(xs[i + 1]!, right(b)) - Math.max(xs[i]!, b.x) > 1) RouteGrid.bump(this.hCost, j * (nx - 1) + i, cost);
      }
    }
    for (const x of [b.x, right(b)]) {
      const i = RouteGrid.lower(xs, x - EPS);
      if (i >= nx || Math.abs(xs[i]! - x) > EPS) continue;
      for (let j = Math.max(0, RouteGrid.upper(ys, b.y) - 1); j < ny - 1 && ys[j]! < bottom(b); j++) {
        if (Math.min(ys[j + 1]!, bottom(b)) - Math.max(ys[j]!, b.y) > 1) RouteGrid.bump(this.vCost, j * nx + i, cost);
      }
    }
  }

  /** a line crosses grid row j at x (a crossing exactly at a node is split between the two edges) */
  private crossRow(j: number, x: number, cost = CROSS): void {
    const { xs, nx } = this;
    const k = RouteGrid.lower(xs, x);
    if (k < nx && Math.abs(xs[k]! - x) < EPS) {
      if (k > 0) RouteGrid.bump(this.hCost, j * (nx - 1) + k - 1, cost / 2);
      if (k < nx - 1) RouteGrid.bump(this.hCost, j * (nx - 1) + k, cost / 2);
    } else if (k > 0 && k < nx) RouteGrid.bump(this.hCost, j * (nx - 1) + k - 1, cost);
  }

  /** a line crosses grid column i at y */
  private crossColumn(i: number, y: number, cost = CROSS): void {
    const { ys, nx, ny } = this;
    const k = RouteGrid.lower(ys, y);
    if (k < ny && Math.abs(ys[k]! - y) < EPS) {
      if (k > 0) RouteGrid.bump(this.vCost, (k - 1) * nx + i, cost / 2);
      if (k < ny - 1) RouteGrid.bump(this.vCost, k * nx + i, cost / 2);
    } else if (k > 0 && k < ny) RouteGrid.bump(this.vCost, (k - 1) * nx + i, cost);
  }

  markLine(seg: Seg): void {
    const { xs, ys, nx, ny } = this;
    const { a, b } = seg;
    const x1 = Math.min(a.x, b.x), x2 = Math.max(a.x, b.x), y1 = Math.min(a.y, b.y), y2 = Math.max(a.y, b.y);
    // crossing next to the line's start / end (its arrowhead) costs more
    const cost = (p: Point): number => (seg.ends?.some((e) => Math.abs(e.x - p.x) + Math.abs(e.y - p.y) < END_ZONE) ? 2 * CROSS : CROSS);
    if (seg.kind !== 'h') {
      for (let j = RouteGrid.upper(ys, y1); j < ny && ys[j]! < y2; j++) {
        const x = seg.kind === 'v' ? a.x : a.x + ((ys[j]! - a.y) * (b.x - a.x)) / (b.y - a.y);
        this.crossRow(j, x, cost({ x, y: ys[j]! }));
      }
    }
    if (seg.kind !== 'v') {
      for (let i = RouteGrid.upper(xs, x1); i < nx && xs[i]! < x2; i++) {
        const y = seg.kind === 'h' ? a.y : a.y + ((xs[i]! - a.x) * (b.y - a.y)) / (b.x - a.x);
        this.crossColumn(i, y, cost({ x: xs[i]!, y }));
      }
    }
    // a join's entry may follow another entry's tail into the same vertex (targetMerge): marked apart. An overlap
    // counts from 1 px; on a tail every grid edge inside it counts, a short one too (a route leaving the tail there
    // pays the overlap in astar)
    const hFlag = seg.merge ? this.hMg : this.hOv, vFlag = seg.merge ? this.vMg : this.vOv;
    const least = (len: number): number => (seg.merge ? Math.min(1, len - EPS) : 1);
    if (seg.kind === 'h') {
      for (let j = RouteGrid.lower(ys, a.y - OVERLAP_TOL); j < ny && ys[j]! <= a.y + OVERLAP_TOL; j++) {
        for (let i = Math.max(0, RouteGrid.upper(xs, x1) - 1); i < nx - 1 && xs[i]! < x2; i++) {
          if (Math.min(xs[i + 1]!, x2) - Math.max(xs[i]!, x1) > least(xs[i + 1]! - xs[i]!)) hFlag[j * (nx - 1) + i] = 1;
        }
      }
    } else if (seg.kind === 'v') {
      for (let i = RouteGrid.lower(xs, a.x - OVERLAP_TOL); i < nx && xs[i]! <= a.x + OVERLAP_TOL; i++) {
        for (let j = Math.max(0, RouteGrid.upper(ys, y1) - 1); j < ny - 1 && ys[j]! < y2; j++) {
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
  guardVertices(b: Box): void {
    const { xs, ys, nx, ny } = this;
    const at = (arr: number[], v: number): number => {
      const k = RouteGrid.lower(arr, v - EPS);
      return k < arr.length && Math.abs(arr[k]! - v) < EPS ? k : -1;
    };
    for (const side of ['top', 'right', 'bottom', 'left'] as const) {
      const [lo, hi] = span(b, side);
      const v = pointOn(b, side, Math.round(lo + (hi - lo) / 2));
      const d = OUTWARD[side];
      const i = at(xs, v.x), j = at(ys, v.y);
      if (j >= 0) for (let k = 0; k + 1 < nx; k++) if (xs[k]! <= v.x + EPS && xs[k + 1]! >= v.x - EPS && !(d === 0 && k === i) && !(d === 2 && k + 1 === i)) RouteGrid.bump(this.hCost, j * (nx - 1) + k, HIT);
      if (i >= 0) for (let k = 0; k + 1 < ny; k++) if (ys[k]! <= v.y + EPS && ys[k + 1]! >= v.y - EPS && !(d === 1 && k === j) && !(d === 3 && k + 1 === j)) RouteGrid.bump(this.vCost, k * nx + i, HIT);
    }
  }

  /** nodes closer than the stub to a side of the source or target (turning there costs) */
  markStubZones(b: Box, stub: number): void {
    const { xs, ys, nx } = this;
    const zones: Array<{ x1: number; x2: number; y1: number; y2: number }> = [
      { x1: right(b), x2: right(b) + stub, y1: b.y, y2: bottom(b) },
      { x1: b.x - stub, x2: b.x, y1: b.y, y2: bottom(b) },
      { x1: b.x, x2: right(b), y1: bottom(b), y2: bottom(b) + stub },
      { x1: b.x, x2: right(b), y1: b.y - stub, y2: b.y },
    ];
    zones.forEach((z, k) => {
      for (let i = RouteGrid.lower(xs, z.x1); i < nx && xs[i]! <= z.x2; i++) {
        for (let j = RouteGrid.lower(ys, z.y1); j < ys.length && ys[j]! <= z.y2; j++) {
          const x = xs[i]!, y = ys[j]!;
          // the far edge of the zone (exactly one stub away) is outside it
          const inside = k === 0 ? x < z.x2 : k === 1 ? x > z.x1 : k === 2 ? y < z.y2 : y > z.y1;
          if (inside) this.turn[j * nx + i] = STUB_TURN;
        }
      }
    });
  }

  /** grid node of a port (ports are always grid lines; undefined when outside the region) */
  nodeOf(p: Point): number | undefined {
    const i = RouteGrid.lower(this.xs, p.x), j = RouteGrid.lower(this.ys, p.y);
    if (i >= this.nx || j >= this.ny || Math.abs(this.xs[i]! - p.x) > EPS || Math.abs(this.ys[j]! - p.y) > EPS) return undefined;
    return j * this.nx + i;
  }

  trace(goal: number, parent: Int32Array, nOv: number): Point[] {
    const pts: Point[] = [];
    for (let st = goal; st >= 0; st = parent[st]!) {
      const node = Math.floor(Math.floor(st / nOv) / 4);
      pts.push({ x: this.xs[node % this.nx]!, y: this.ys[Math.floor(node / this.nx)]! });
      if (parent[st] === -1) break;
    }
    return simplify(pts.reverse());
  }
}
