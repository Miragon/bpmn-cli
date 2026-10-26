import type { Box, Point } from '../../di/types.js';
import { bottom, right } from '../../utils/geom.js';
import { CROSS, END_ZONE, EPS, HIT, OUTWARD, OVERLAP_TOL, STUB_TURN, pointOn, simplify, span, type Seg } from '../../utils/routing.js';

export class RouteGrid {
  readonly nx: number;
  readonly ny: number;
  /** horizontal edge (i,j)-(i+1,j) at j·(nx-1)+i, vertical edge (i,j)-(i,j+1) at j·nx+i */
  readonly hCost: Float64Array;
  readonly vCost: Float64Array;
  readonly hOv: Uint8Array;
  readonly vOv: Uint8Array;
  anyOv = false;
  /** on a shared tail into a join's vertex and on no other line */
  readonly hMg: Uint8Array;
  readonly vMg: Uint8Array;
  anyMg = false;
  /** turning within the stub zones of source and target */
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

  private static upper(arr: number[], target: number): number {
    let lo = 0, hi = arr.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid]! > target) hi = mid;
      else lo = mid + 1;
    }
    return lo;
  }

  private static lower(arr: number[], target: number): number {
    let lo = 0, hi = arr.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid]! >= target) hi = mid;
      else lo = mid + 1;
    }
    return lo;
  }

  private static bump(arr: Float64Array, index: number, amount: number): void {
    arr[index] = arr[index]! + amount;
  }

  addInside(box: Box, perEdge: number, perPx: number): void {
    const { xs, ys, nx, ny } = this;
    for (let row = RouteGrid.upper(ys, box.y); row < ny && ys[row]! < bottom(box); row++) {
      for (let column = Math.max(0, RouteGrid.upper(xs, box.x) - 1); column < nx - 1 && xs[column]! < right(box); column++) {
        RouteGrid.bump(this.hCost, row * (nx - 1) + column, perEdge + perPx * (xs[column + 1]! - xs[column]!));
      }
    }
    for (let column = RouteGrid.upper(xs, box.x); column < nx && xs[column]! < right(box); column++) {
      for (let row = Math.max(0, RouteGrid.upper(ys, box.y) - 1); row < ny - 1 && ys[row]! < bottom(box); row++) {
        RouteGrid.bump(this.vCost, row * nx + column, perEdge + perPx * (ys[row + 1]! - ys[row]!));
      }
    }
  }

  addOutline(box: Box, cost: number): void {
    const { xs, ys, nx, ny } = this;
    for (const edgeY of [box.y, bottom(box)]) {
      const row = RouteGrid.lower(ys, edgeY - EPS);
      if (row >= ny || Math.abs(ys[row]! - edgeY) > EPS) continue;
      for (let column = Math.max(0, RouteGrid.upper(xs, box.x) - 1); column < nx - 1 && xs[column]! < right(box); column++) {
        if (Math.min(xs[column + 1]!, right(box)) - Math.max(xs[column]!, box.x) > 1) RouteGrid.bump(this.hCost, row * (nx - 1) + column, cost);
      }
    }
    for (const edgeX of [box.x, right(box)]) {
      const column = RouteGrid.lower(xs, edgeX - EPS);
      if (column >= nx || Math.abs(xs[column]! - edgeX) > EPS) continue;
      for (let row = Math.max(0, RouteGrid.upper(ys, box.y) - 1); row < ny - 1 && ys[row]! < bottom(box); row++) {
        if (Math.min(ys[row + 1]!, bottom(box)) - Math.max(ys[row]!, box.y) > 1) RouteGrid.bump(this.vCost, row * nx + column, cost);
      }
    }
  }

  /** A crossing exactly at a node is split between the two edges. */
  private crossRow(row: number, crossX: number, cost = CROSS): void {
    const { xs, nx } = this;
    const column = RouteGrid.lower(xs, crossX);
    if (column < nx && Math.abs(xs[column]! - crossX) < EPS) {
      if (column > 0) RouteGrid.bump(this.hCost, row * (nx - 1) + column - 1, cost / 2);
      if (column < nx - 1) RouteGrid.bump(this.hCost, row * (nx - 1) + column, cost / 2);
    } else if (column > 0 && column < nx) RouteGrid.bump(this.hCost, row * (nx - 1) + column - 1, cost);
  }

  private crossColumn(column: number, crossY: number, cost = CROSS): void {
    const { ys, nx, ny } = this;
    const row = RouteGrid.lower(ys, crossY);
    if (row < ny && Math.abs(ys[row]! - crossY) < EPS) {
      if (row > 0) RouteGrid.bump(this.vCost, (row - 1) * nx + column, cost / 2);
      if (row < ny - 1) RouteGrid.bump(this.vCost, row * nx + column, cost / 2);
    } else if (row > 0 && row < ny) RouteGrid.bump(this.vCost, (row - 1) * nx + column, cost);
  }

  markLine(seg: Seg): void {
    const { xs, ys, nx, ny } = this;
    const { start, end } = seg;
    const x1 = Math.min(start.x, end.x), x2 = Math.max(start.x, end.x), y1 = Math.min(start.y, end.y), y2 = Math.max(start.y, end.y);
    const cost = (point: Point): number => (seg.ends?.some((endPoint) => Math.abs(endPoint.x - point.x) + Math.abs(endPoint.y - point.y) < END_ZONE) ? 2 * CROSS : CROSS);
    if (seg.kind !== 'h') {
      for (let row = RouteGrid.upper(ys, y1); row < ny && ys[row]! < y2; row++) {
        const crossX = seg.kind === 'v' ? start.x : start.x + ((ys[row]! - start.y) * (end.x - start.x)) / (end.y - start.y);
        this.crossRow(row, crossX, cost({ x: crossX, y: ys[row]! }));
      }
    }
    if (seg.kind !== 'v') {
      for (let column = RouteGrid.upper(xs, x1); column < nx && xs[column]! < x2; column++) {
        const crossY = seg.kind === 'h' ? start.y : start.y + ((xs[column]! - start.x) * (end.y - start.y)) / (end.x - start.x);
        this.crossColumn(column, crossY, cost({ x: xs[column]!, y: crossY }));
      }
    }
    /**
     * shared tails are marked apart: every grid edge on one counts, even a short one,
     * since a route leaving the tail pays the overlap in astar
     */
    const hFlag = seg.merge ? this.hMg : this.hOv, vFlag = seg.merge ? this.vMg : this.vOv;
    const least = (len: number): number => (seg.merge ? Math.min(1, len - EPS) : 1);
    if (seg.kind === 'h') {
      for (let row = RouteGrid.lower(ys, start.y - OVERLAP_TOL); row < ny && ys[row]! <= start.y + OVERLAP_TOL; row++) {
        for (let column = Math.max(0, RouteGrid.upper(xs, x1) - 1); column < nx - 1 && xs[column]! < x2; column++) {
          if (Math.min(xs[column + 1]!, x2) - Math.max(xs[column]!, x1) > least(xs[column + 1]! - xs[column]!)) hFlag[row * (nx - 1) + column] = 1;
        }
      }
    } else if (seg.kind === 'v') {
      for (let column = RouteGrid.lower(xs, start.x - OVERLAP_TOL); column < nx && xs[column]! <= start.x + OVERLAP_TOL; column++) {
        for (let row = Math.max(0, RouteGrid.upper(ys, y1) - 1); row < ny - 1 && ys[row]! < y2; row++) {
          if (Math.min(ys[row + 1]!, y2) - Math.max(ys[row]!, y1) > least(ys[row + 1]! - ys[row]!)) vFlag[row * nx + column] = 1;
        }
      }
    }
  }

  /** A gateway target is touched only at its port: other vertices of the diamond cost HIT. */
  guardVertices(box: Box): void {
    const { xs, ys, nx, ny } = this;
    const at = (arr: number[], coordinate: number): number => {
      const index = RouteGrid.lower(arr, coordinate - EPS);
      return index < arr.length && Math.abs(arr[index]! - coordinate) < EPS ? index : -1;
    };
    for (const side of ['top', 'right', 'bottom', 'left'] as const) {
      const [lo, hi] = span(box, side);
      const vertex = pointOn(box, side, Math.round(lo + (hi - lo) / 2));
      const outward = OUTWARD[side];
      const column = at(xs, vertex.x), row = at(ys, vertex.y);
      if (row >= 0) for (let cell = 0; cell + 1 < nx; cell++) if (xs[cell]! <= vertex.x + EPS && xs[cell + 1]! >= vertex.x - EPS && !(outward === 0 && cell === column) && !(outward === 2 && cell + 1 === column)) RouteGrid.bump(this.hCost, row * (nx - 1) + cell, HIT);
      if (column >= 0) for (let cell = 0; cell + 1 < ny; cell++) if (ys[cell]! <= vertex.y + EPS && ys[cell + 1]! >= vertex.y - EPS && !(outward === 1 && cell === row) && !(outward === 3 && cell + 1 === row)) RouteGrid.bump(this.vCost, cell * nx + column, HIT);
    }
  }

  markStubZones(box: Box, stub: number): void {
    const { xs, ys, nx } = this;
    const zones: Array<{ x1: number; x2: number; y1: number; y2: number }> = [
      { x1: right(box), x2: right(box) + stub, y1: box.y, y2: bottom(box) },
      { x1: box.x - stub, x2: box.x, y1: box.y, y2: bottom(box) },
      { x1: box.x, x2: right(box), y1: bottom(box), y2: bottom(box) + stub },
      { x1: box.x, x2: right(box), y1: box.y - stub, y2: box.y },
    ];
    zones.forEach((zone, zoneIndex) => {
      for (let column = RouteGrid.lower(xs, zone.x1); column < nx && xs[column]! <= zone.x2; column++) {
        for (let row = RouteGrid.lower(ys, zone.y1); row < ys.length && ys[row]! <= zone.y2; row++) {
          const pointX = xs[column]!, pointY = ys[row]!;
          const inside = zoneIndex === 0 ? pointX < zone.x2 : zoneIndex === 1 ? pointX > zone.x1 : zoneIndex === 2 ? pointY < zone.y2 : pointY > zone.y1;
          if (inside) this.turn[row * nx + column] = STUB_TURN;
        }
      }
    });
  }

  nodeOf(point: Point): number | undefined {
    const column = RouteGrid.lower(this.xs, point.x), row = RouteGrid.lower(this.ys, point.y);
    if (column >= this.nx || row >= this.ny || Math.abs(this.xs[column]! - point.x) > EPS || Math.abs(this.ys[row]! - point.y) > EPS) return undefined;
    return row * this.nx + column;
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
