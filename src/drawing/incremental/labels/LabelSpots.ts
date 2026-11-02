import { Box, Polyline, type Point } from '../../../model/index.js';
import { DrawnPlane } from '../../../scoring/index.js';
import type { PlaneShape, LabelSide } from '../../plane/PlaneShape.js';
import { ShapeSides } from '../../plane/ShapeSides.js';

export interface LabelSize {
  width: number;
  height: number;
}

export class LabelSpots {
  private static readonly STEPS = 3;
  private static readonly BESIDE = 6;
  private static readonly ABOVE = 4;

  constructor(private readonly size: LabelSize) {}

  private box(left: number, top: number): Box {
    return new Box(Math.round(left), Math.round(top), this.size.width, this.size.height);
  }

  aroundSide(shape: PlaneShape, side: LabelSide, name: string | undefined, host?: PlaneShape): Box[] {
    const { width, height } = this.size;
    const { center } = shape.bounds;
    const over = name ? Math.max(0, DrawnPlane.glyph(shape.bounds, name).width - width) / 2 : 0;
    const spots: Box[] = [];
    for (let step = 0; step < LabelSpots.STEPS; step++) {
      const base = shape.labelAt(this.size, side, host, step);
      spots.push(base);
      if (side === 'below' || side === 'above') {
        for (const shift of over ? [0, over] : [0]) {
          spots.push(new Box(Math.round(center.x + LabelSpots.BESIDE + shift), base.y, width, height), new Box(Math.round(center.x - LabelSpots.BESIDE - width - shift), base.y, width, height));
        }
      } else {
        spots.push(new Box(base.x, Math.round(center.y + LabelSpots.BESIDE), width, height), new Box(base.x, Math.round(center.y - LabelSpots.BESIDE - height), width, height));
      }
    }
    return spots;
  }

  onBoundary(boundary: Box, host: Box, step: number): Box[] {
    const { width, height } = this.size;
    const stacked = step * (height + 4);
    const middle = boundary.center;
    switch (ShapeSides.attached(boundary, host)) {
      case 'top': {
        const top = host.y - 2 - height - stacked;
        return [this.box(boundary.right + 4, top), this.box(boundary.x - 4 - width, top), this.box(middle.x - width / 2, Math.min(top, boundary.y - 4 - height))];
      }
      case 'right':
        return this.besideBoundary(boundary, Math.max(host.right + 2 + step * 10, boundary.right + 4), stacked);
      case 'left':
        return this.besideBoundary(boundary, Math.min(host.x - 2 - width - step * 10, boundary.x - 4 - width), stacked);
      default: {
        const top = host.bottom + 2 + stacked;
        return [this.box(boundary.right + 4, top), this.box(boundary.x - 4 - width, top), this.box(middle.x - width / 2, Math.max(top, boundary.bottom + 4))];
      }
    }
  }

  alongEdge(points: readonly Point[]): Box[] {
    const { height } = this.size;
    const segments = new Polyline(points).segments();
    const spots = [...segments.flatMap(({ start, end }) => this.overRun(start, end)), ...segments.flatMap(({ start, end }) => this.besideRun(start, end))];
    if (!spots.length) {
      const start = points[0]!;
      spots.push(this.box(start.x + LabelSpots.BESIDE, start.y - height - LabelSpots.ABOVE));
    }
    return spots;
  }

  private besideBoundary(boundary: Box, left: number, stacked: number): Box[] {
    const { height } = this.size;
    return [this.box(left, boundary.bottom + 4 + stacked), this.box(left, boundary.y - 4 - height - stacked), this.box(left, boundary.center.y - height / 2)];
  }

  private overRun(start: Point, end: Point): Box[] {
    const { width, height } = this.size;
    const low = Math.min(start.x, end.x), high = Math.max(start.x, end.x);
    if (Math.abs(start.y - end.y) >= 0.5 || high - low < width / 2) {
      return [];
    }
    const lefts = [Math.min(low + 8, Math.max(low + 2, high - width - 4)), (low + high) / 2 - width / 2, high - width - 8];
    return lefts.flatMap((left) => [this.box(left, start.y - height - LabelSpots.ABOVE), this.box(left, start.y + LabelSpots.ABOVE)]);
  }

  private besideRun(start: Point, end: Point): Box[] {
    const { width, height } = this.size;
    if (Math.abs(start.x - end.x) >= 0.5 || Math.abs(start.y - end.y) < height) {
      return [];
    }
    const top = Math.round(Math.min(start.y, end.y) + Math.abs(start.y - end.y) / 2 - height / 2);
    return [this.box(start.x + LabelSpots.BESIDE, top), this.box(start.x - width - LabelSpots.BESIDE, top)];
  }
}
