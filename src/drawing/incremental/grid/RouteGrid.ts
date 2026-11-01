import { Point, Polyline, type Box } from '../../../model/index.js';
import { ShapeSides, type Side } from '../../plane/ShapeSides.js';
import { RouteCosts } from '../routing/RouteCosts.js';
import type { Seg } from '../routing/RouteLines.js';

type Spot = Pick<Point, 'x' | 'y'>;

export class RouteGrid {
  readonly nx: number;
  readonly ny: number;
  readonly hCost: Float64Array;
  readonly vCost: Float64Array;
  readonly hOv: Uint8Array;
  readonly vOv: Uint8Array;
  anyOv = false;
  readonly hMg: Uint8Array;
  readonly vMg: Uint8Array;
  anyMg = false;
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

  private static upper(sorted: number[], target: number): number {
    let low = 0, high = sorted.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (sorted[middle]! > target) {
        high = middle;
      } else {
        low = middle + 1;
      }
    }
    return low;
  }

  private static lower(sorted: number[], target: number): number {
    let low = 0, high = sorted.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (sorted[middle]! >= target) {
        high = middle;
      } else {
        low = middle + 1;
      }
    }
    return low;
  }

  private static bump(costs: Float64Array, index: number, amount: number): void {
    costs[index] = costs[index]! + amount;
  }

  private static exactIndex(sorted: number[], coordinate: number): number {
    const index = RouteGrid.lower(sorted, coordinate - RouteCosts.EPS);
    return index < sorted.length && Math.abs(sorted[index]! - coordinate) < RouteCosts.EPS ? index : -1;
  }

  addInside(box: Box, perEdge: number, perPx: number): void {
    const { xs, ys, nx, ny } = this;
    for (let row = RouteGrid.upper(ys, box.y); row < ny && ys[row]! < box.bottom; row++) {
      for (let column = Math.max(0, RouteGrid.upper(xs, box.x) - 1); column < nx - 1 && xs[column]! < box.right; column++) {
        RouteGrid.bump(this.hCost, row * (nx - 1) + column, perEdge + perPx * (xs[column + 1]! - xs[column]!));
      }
    }
    for (let column = RouteGrid.upper(xs, box.x); column < nx && xs[column]! < box.right; column++) {
      for (let row = Math.max(0, RouteGrid.upper(ys, box.y) - 1); row < ny - 1 && ys[row]! < box.bottom; row++) {
        RouteGrid.bump(this.vCost, row * nx + column, perEdge + perPx * (ys[row + 1]! - ys[row]!));
      }
    }
  }

  addOutline(box: Box, cost: number): void {
    for (const edgeY of [box.y, box.bottom]) {
      this.outlineRow(box, edgeY, cost);
    }
    for (const edgeX of [box.x, box.right]) {
      this.outlineColumn(box, edgeX, cost);
    }
  }

  markLine(seg: Seg): void {
    const { start, end, kind } = seg;
    const x1 = Math.min(start.x, end.x), x2 = Math.max(start.x, end.x), y1 = Math.min(start.y, end.y), y2 = Math.max(start.y, end.y);
    if (kind !== 'h' && !seg.free) {
      this.crossRows(seg, y1, y2);
    }
    if (kind !== 'v' && !seg.free) {
      this.crossColumns(seg, x1, x2);
    }
    if (kind === 'h') {
      this.flagRows(seg, x1, x2);
    } else if (kind === 'v') {
      this.flagColumns(seg, y1, y2);
    }
  }

  guardVertices(box: Box): void {
    for (const side of ['top', 'right', 'bottom', 'left'] as const) {
      const [low, high] = ShapeSides.span(box, side);
      this.guardVertex(ShapeSides.pointOn(box, side, Math.round(low + (high - low) / 2)), side);
    }
  }

  markStubZones(box: Box, stub: number): void {
    const { x, y, right, bottom } = box;
    this.markZone([right, right + stub], [y, bottom], (pointX) => pointX < right + stub);
    this.markZone([x - stub, x], [y, bottom], (pointX) => pointX > x - stub);
    this.markZone([x, right], [bottom, bottom + stub], (_, pointY) => pointY < bottom + stub);
    this.markZone([x, right], [y - stub, y], (_, pointY) => pointY > y - stub);
  }

  nodeOf(point: Spot): number | undefined {
    const column = RouteGrid.lower(this.xs, point.x), row = RouteGrid.lower(this.ys, point.y);
    if (column >= this.nx || row >= this.ny || Math.abs(this.xs[column]! - point.x) > RouteCosts.EPS || Math.abs(this.ys[row]! - point.y) > RouteCosts.EPS) {
      return undefined;
    }
    return row * this.nx + column;
  }

  trace(goal: number, parent: Int32Array, layers: number): Point[] {
    const points: Point[] = [];
    for (let state = goal; state >= 0; state = parent[state]!) {
      const node = Math.floor(Math.floor(state / layers) / 4);
      points.push(new Point(this.xs[node % this.nx]!, this.ys[Math.floor(node / this.nx)]!));
      if (parent[state] === -1) {
        break;
      }
    }
    return new Polyline(points.reverse()).simplified();
  }

  private outlineRow(box: Box, edgeY: number, cost: number): void {
    const { xs, ys, nx, ny } = this;
    const row = RouteGrid.lower(ys, edgeY - RouteCosts.EPS);
    if (row >= ny || Math.abs(ys[row]! - edgeY) > RouteCosts.EPS) {
      return;
    }
    for (let column = Math.max(0, RouteGrid.upper(xs, box.x) - 1); column < nx - 1 && xs[column]! < box.right; column++) {
      if (Math.min(xs[column + 1]!, box.right) - Math.max(xs[column]!, box.x) > 1) {
        RouteGrid.bump(this.hCost, row * (nx - 1) + column, cost);
      }
    }
  }

  private outlineColumn(box: Box, edgeX: number, cost: number): void {
    const { xs, ys, nx, ny } = this;
    const column = RouteGrid.lower(xs, edgeX - RouteCosts.EPS);
    if (column >= nx || Math.abs(xs[column]! - edgeX) > RouteCosts.EPS) {
      return;
    }
    for (let row = Math.max(0, RouteGrid.upper(ys, box.y) - 1); row < ny - 1 && ys[row]! < box.bottom; row++) {
      if (Math.min(ys[row + 1]!, box.bottom) - Math.max(ys[row]!, box.y) > 1) {
        RouteGrid.bump(this.vCost, row * nx + column, cost);
      }
    }
  }

  private crossCost(seg: Seg, x: number, y: number): number {
    const nearEnd = seg.ends?.some((end) => Math.abs(end.x - x) + Math.abs(end.y - y) < RouteCosts.END_ZONE);
    return nearEnd ? 2 * RouteCosts.CROSS : RouteCosts.CROSS;
  }

  private crossRows(seg: Seg, y1: number, y2: number): void {
    const { start, end, kind } = seg;
    const { ys, ny } = this;
    for (let row = RouteGrid.upper(ys, y1); row < ny && ys[row]! < y2; row++) {
      const crossX = kind === 'v' ? start.x : start.x + ((ys[row]! - start.y) * (end.x - start.x)) / (end.y - start.y);
      this.crossRow(row, crossX, this.crossCost(seg, crossX, ys[row]!));
    }
  }

  private crossColumns(seg: Seg, x1: number, x2: number): void {
    const { start, end, kind } = seg;
    const { xs, nx } = this;
    for (let column = RouteGrid.upper(xs, x1); column < nx && xs[column]! < x2; column++) {
      const crossY = kind === 'h' ? start.y : start.y + ((xs[column]! - start.x) * (end.y - start.y)) / (end.x - start.x);
      this.crossColumn(column, crossY, this.crossCost(seg, xs[column]!, crossY));
    }
  }

  private crossRow(row: number, crossX: number, cost: number): void {
    const { xs, nx } = this;
    const column = RouteGrid.lower(xs, crossX);
    if (column < nx && Math.abs(xs[column]! - crossX) < RouteCosts.EPS) {
      if (column > 0) {
        RouteGrid.bump(this.hCost, row * (nx - 1) + column - 1, cost / 2);
      }
      if (column < nx - 1) {
        RouteGrid.bump(this.hCost, row * (nx - 1) + column, cost / 2);
      }
    } else if (column > 0 && column < nx) {
      RouteGrid.bump(this.hCost, row * (nx - 1) + column - 1, cost);
    }
  }

  private crossColumn(column: number, crossY: number, cost: number): void {
    const { ys, nx, ny } = this;
    const row = RouteGrid.lower(ys, crossY);
    if (row < ny && Math.abs(ys[row]! - crossY) < RouteCosts.EPS) {
      if (row > 0) {
        RouteGrid.bump(this.vCost, (row - 1) * nx + column, cost / 2);
      }
      if (row < ny - 1) {
        RouteGrid.bump(this.vCost, row * nx + column, cost / 2);
      }
    } else if (row > 0 && row < ny) {
      RouteGrid.bump(this.vCost, (row - 1) * nx + column, cost);
    }
  }

  private overlapNeeded(seg: Seg, length: number): number {
    return seg.merge ? Math.min(1, length - RouteCosts.EPS) : 1;
  }

  private flagRows(seg: Seg, x1: number, x2: number): void {
    const { xs, ys, nx, ny } = this;
    const flags = seg.merge ? this.hMg : this.hOv;
    const lineY = seg.start.y;
    for (let row = RouteGrid.lower(ys, lineY - RouteCosts.OVERLAP_TOL); row < ny && ys[row]! <= lineY + RouteCosts.OVERLAP_TOL; row++) {
      for (let column = Math.max(0, RouteGrid.upper(xs, x1) - 1); column < nx - 1 && xs[column]! < x2; column++) {
        if (Math.min(xs[column + 1]!, x2) - Math.max(xs[column]!, x1) > this.overlapNeeded(seg, xs[column + 1]! - xs[column]!)) {
          flags[row * (nx - 1) + column] = 1;
        }
      }
    }
  }

  private flagColumns(seg: Seg, y1: number, y2: number): void {
    const { xs, ys, nx, ny } = this;
    const flags = seg.merge ? this.vMg : this.vOv;
    const lineX = seg.start.x;
    for (let column = RouteGrid.lower(xs, lineX - RouteCosts.OVERLAP_TOL); column < nx && xs[column]! <= lineX + RouteCosts.OVERLAP_TOL; column++) {
      for (let row = Math.max(0, RouteGrid.upper(ys, y1) - 1); row < ny - 1 && ys[row]! < y2; row++) {
        if (Math.min(ys[row + 1]!, y2) - Math.max(ys[row]!, y1) > this.overlapNeeded(seg, ys[row + 1]! - ys[row]!)) {
          flags[row * nx + column] = 1;
        }
      }
    }
  }

  private guardVertex(vertex: Point, side: Side): void {
    const outward = RouteCosts.OUTWARD[side];
    const column = RouteGrid.exactIndex(this.xs, vertex.x), row = RouteGrid.exactIndex(this.ys, vertex.y);
    if (row >= 0) {
      this.guardRow(vertex, row, column, outward);
    }
    if (column >= 0) {
      this.guardColumn(vertex, row, column, outward);
    }
  }

  private guardRow(vertex: Point, row: number, column: number, outward: number): void {
    const { xs, nx } = this;
    for (let cell = 0; cell + 1 < nx; cell++) {
      const leaves = (outward === 0 && cell === column) || (outward === 2 && cell + 1 === column);
      if (xs[cell]! <= vertex.x + RouteCosts.EPS && xs[cell + 1]! >= vertex.x - RouteCosts.EPS && !leaves) {
        RouteGrid.bump(this.hCost, row * (nx - 1) + cell, RouteCosts.HIT);
      }
    }
  }

  private guardColumn(vertex: Point, row: number, column: number, outward: number): void {
    const { ys, nx, ny } = this;
    for (let cell = 0; cell + 1 < ny; cell++) {
      const leaves = (outward === 1 && cell === row) || (outward === 3 && cell + 1 === row);
      if (ys[cell]! <= vertex.y + RouteCosts.EPS && ys[cell + 1]! >= vertex.y - RouteCosts.EPS && !leaves) {
        RouteGrid.bump(this.vCost, cell * nx + column, RouteCosts.HIT);
      }
    }
  }

  private markZone([x1, x2]: [number, number], [y1, y2]: [number, number], inside: (x: number, y: number) => boolean): void {
    const { xs, ys, nx, ny } = this;
    for (let column = RouteGrid.lower(xs, x1); column < nx && xs[column]! <= x2; column++) {
      for (let row = RouteGrid.lower(ys, y1); row < ny && ys[row]! <= y2; row++) {
        if (inside(xs[column]!, ys[row]!)) {
          this.turn[row * nx + column] = RouteCosts.STUB_TURN;
        }
      }
    }
  }
}
