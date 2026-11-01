import { Box } from '../../../model/index.js';
import { RouteCosts } from '../routing/RouteCosts.js';
import { RouteGrid } from './RouteGrid.js';
import type { RouteScene } from '../routing/RouteScene.js';

interface GridLines {
  xs: number[];
  ys: number[];
}

export class RouteGridBuilder {
  constructor(
    private readonly scene: RouteScene,
    private readonly frame: Box | undefined,
  ) {}

  private static intersect(first: Box, second: Box): Box {
    const left = Math.max(first.x, second.x), top = Math.max(first.y, second.y);
    return new Box(left, top, Math.max(0, Math.min(first.right, second.right) - left), Math.max(0, Math.min(first.bottom, second.bottom) - top));
  }

  private static touches(first: Box, second: Box): boolean {
    return first.x <= second.right && first.right >= second.x && first.y <= second.bottom && first.bottom >= second.y;
  }

  private static sortedUnique(values: number[], low: number, high: number): number[] {
    const sorted: number[] = [];
    for (const value of values.filter((candidate) => Number.isFinite(candidate) && candidate >= low && candidate <= high).sort((first, second) => first - second)) {
      if (!sorted.length || value - sorted.at(-1)! > RouteCosts.EPS) {
        sorted.push(value);
      }
    }
    return sorted;
  }

  grid(wide: boolean): RouteGrid {
    const extent = this.region(wide);
    const included = this.scene.obstacles.filter((obstacle) => RouteGridBuilder.touches(obstacle, extent));
    const { xs, ys } = this.gridLines(extent, included);
    const grid = new RouteGrid(xs, ys);
    this.layCosts(grid, included);
    this.markLines(grid, extent);
    grid.markStubZones(this.scene.source, this.scene.stub);
    grid.markStubZones(this.scene.target, this.scene.stub);
    return grid;
  }

  private clip(box: Box): Box {
    return this.frame ? RouteGridBuilder.intersect(box, this.frame) : box;
  }

  private region(wide: boolean): Box {
    const { source, target, obstacles, margin, stub } = this.scene;
    const spread = 2 * margin + 10;
    let extent = source.union(target).grow(Math.max(RouteCosts.REGION_PAD, 2 * stub + 20));
    if (wide) {
      for (const obstacle of obstacles) {
        extent = extent.union(obstacle.grow(spread));
      }
    }
    extent = this.clip(extent);
    for (let round = 0; round < 2; round++) {
      let next = extent;
      for (const obstacle of obstacles) {
        if (RouteGridBuilder.touches(obstacle, extent)) {
          next = next.union(obstacle.grow(spread));
        }
      }
      next = this.clip(next);
      if (Box.same(next, extent, 0)) {
        break;
      }
      extent = next;
    }
    return extent;
  }

  private gridLines(extent: Box, included: readonly Box[]): GridLines {
    const lines: GridLines = { xs: [], ys: [] };
    this.addPortLines(lines);
    this.addMiddles(lines);
    this.addBoxLines(lines, included);
    return { xs: RouteGridBuilder.sortedUnique(lines.xs, extent.x, extent.right), ys: RouteGridBuilder.sortedUnique(lines.ys, extent.y, extent.bottom) };
  }

  private addPortLines({ xs, ys }: GridLines): void {
    const { src, tgt, segs, source, target, stub } = this.scene;
    for (const port of [...src, ...tgt]) {
      xs.push(port.x);
      ys.push(port.y);
    }
    for (const seg of segs) {
      if (seg.merge && seg.kind === 'v') {
        xs.push(seg.start.x);
      }
      if (seg.merge && seg.kind === 'h') {
        ys.push(seg.start.y);
      }
    }
    for (const box of [source, target]) {
      xs.push(box.x - stub, box.right + stub);
      ys.push(box.y - stub, box.bottom + stub);
    }
  }

  private addMiddles({ xs, ys }: GridLines): void {
    const { source, target } = this.scene;
    if (target.x > source.right) {
      xs.push(Math.round((source.right + target.x) / 2));
    }
    if (source.x > target.right) {
      xs.push(Math.round((target.right + source.x) / 2));
    }
    if (target.y > source.bottom) {
      ys.push(Math.round((source.bottom + target.y) / 2));
    }
    if (source.y > target.bottom) {
      ys.push(Math.round((target.bottom + source.y) / 2));
    }
  }

  private addBoxLines({ xs, ys }: GridLines, included: readonly Box[]): void {
    const { margin } = this.scene;
    for (const obstacle of included) {
      xs.push(obstacle.x - margin, obstacle.right + margin);
      ys.push(obstacle.y - margin, obstacle.bottom + margin);
    }
    if (this.frame) {
      const { x, y, width, height, right, bottom } = this.frame;
      const insetX = Math.round(Math.min(margin, width / 2)), insetY = Math.round(Math.min(margin, height / 2));
      xs.push(x + insetX, right - insetX);
      ys.push(y + insetY, bottom - insetY);
    }
  }

  private layCosts(grid: RouteGrid, included: readonly Box[]): void {
    const { xs, ys, nx, ny } = grid;
    const { source, target, margin, targetMiddle } = this.scene;
    for (let row = 0; row < ny; row++) {
      for (let column = 0; column + 1 < nx; column++) {
        grid.hCost[row * (nx - 1) + column] = xs[column + 1]! - xs[column]!;
      }
    }
    for (let row = 0; row + 1 < ny; row++) {
      for (let column = 0; column < nx; column++) {
        grid.vCost[row * nx + column] = ys[row + 1]! - ys[row]!;
      }
    }
    for (const obstacle of included) {
      grid.addInside(obstacle, RouteCosts.HIT, 0);
      grid.addOutline(obstacle, RouteCosts.OVERLAP);
      if (margin > 0) {
        grid.addInside(obstacle.grow(margin), 0, RouteCosts.NEAR);
      }
    }
    grid.addInside(source, RouteCosts.HIT, 0);
    grid.addInside(target, RouteCosts.HIT, 0);
    if (targetMiddle) {
      grid.guardVertices(target);
    }
  }

  private markLines(grid: RouteGrid, extent: Box): void {
    const near = extent.grow(RouteCosts.OVERLAP_TOL + 1);
    for (const seg of this.scene.segs) {
      const { start, end } = seg;
      const bounds = new Box(Math.min(start.x, end.x), Math.min(start.y, end.y), Math.abs(start.x - end.x), Math.abs(start.y - end.y));
      if (RouteGridBuilder.touches(bounds, near)) {
        grid.markLine(seg);
      }
    }
    grid.anyOv = grid.hOv.some((flag) => flag === 1) || grid.vOv.some((flag) => flag === 1);
    grid.anyMg = grid.hMg.some((flag) => flag === 1) || grid.vMg.some((flag) => flag === 1);
  }
}
