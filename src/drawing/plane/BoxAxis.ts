import type { Box, Point } from '../../model/index.js';

export type Axis = 'x' | 'y';

export type Band = [number, number];

export class BoxAxis {
  private static readonly X = new BoxAxis('x');
  private static readonly Y = new BoxAxis('y');
  private static readonly BAND_TOLERANCE = 1;

  private constructor(private readonly axis: Axis) {}

  static of(axis: Axis): BoxAxis {
    return axis === 'x' ? BoxAxis.X : BoxAxis.Y;
  }

  near(box: Box): number {
    return this.axis === 'x' ? box.x : box.y;
  }

  far(box: Box): number {
    return this.axis === 'x' ? box.right : box.bottom;
  }

  shift(box: Box, delta: number): void {
    if (this.axis === 'x') {
      box.x += delta;
    } else {
      box.y += delta;
    }
  }

  resize(box: Box, delta: number): void {
    if (this.axis === 'x') {
      box.width = Math.max(1, box.width + delta);
    } else {
      box.height = Math.max(1, box.height + delta);
    }
  }

  bandOf(within: Box | undefined): Band | undefined {
    if (!within) {
      return undefined;
    }
    return [this.acrossLow(within), this.acrossHigh(within)];
  }

  centreInBand(box: Box, band: Band | undefined): boolean {
    if (!band) {
      return true;
    }
    const center = this.axis === 'x' ? box.center.y : box.center.x;
    return center >= band[0] && center <= band[1];
  }

  overlapsBand(box: Box, band: Band | undefined): boolean {
    return !band || (this.acrossLow(box) < band[1] && this.acrossHigh(box) > band[0]);
  }

  pointInBand(point: Point, band: Band | undefined): boolean {
    if (!band) {
      return true;
    }
    const across = this.axis === 'x' ? point.y : point.x;
    return across >= band[0] - BoxAxis.BAND_TOLERANCE && across <= band[1] + BoxAxis.BAND_TOLERANCE;
  }

  beyondBand(box: Box, band: Band | undefined): boolean {
    return !!band && (this.acrossLow(box) < band[0] - BoxAxis.BAND_TOLERANCE || this.acrossHigh(box) > band[1] + BoxAxis.BAND_TOLERANCE);
  }

  private acrossLow(box: Box): number {
    return this.axis === 'x' ? box.y : box.x;
  }

  private acrossHigh(box: Box): number {
    return this.axis === 'x' ? box.bottom : box.right;
  }
}
