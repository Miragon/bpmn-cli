import { Box, Polyline, type Point } from '../../../model/index.js';

export class LabelSpots {
  private static readonly SHAPE_GAP = 6;
  private static readonly LINE_GAP = 4;
  private static readonly SPREADS = [0, -0.6, 0.6, -1.2, 1.2];
  private static readonly SIDE_ROWS = [0, -1, 1];
  private static readonly FAR_STEPS = [1, 2, 3];
  private static readonly RUN_SPOTS = [0.05, 0.5, 0.95];
  private static readonly DROP_SPOTS = [0.2, 0.5, 0.8];

  constructor(private readonly label: Box) {}

  aroundShape(shape: Box): { spots: Box[]; near: number } {
    const { label } = this;
    const gap = LabelSpots.SHAPE_GAP;
    const centerX = shape.center.x;
    const below = shape.bottom + gap;
    const above = shape.y - label.height - gap;
    const spots: Box[] = [];
    for (const spread of LabelSpots.SPREADS) {
      const x = Math.round(centerX - label.width / 2 + spread * label.width);
      spots.push(this.at(x, below), this.at(x, above));
    }
    for (const row of LabelSpots.SIDE_ROWS) {
      const y = Math.round(shape.center.y - label.height / 2 + row * label.height);
      spots.push(this.at(shape.right + gap, y), this.at(shape.x - label.width - gap, y));
    }
    const near = spots.length;
    for (const step of LabelSpots.FAR_STEPS) {
      const x = Math.round(centerX - label.width / 2);
      spots.push(this.at(x, below + step * (label.height + LabelSpots.LINE_GAP)), this.at(x, above - step * (label.height + LabelSpots.LINE_GAP)));
    }
    return { spots, near };
  }

  alongLine(points: readonly Point[]): Box[] {
    const { label } = this;
    const spots: Box[] = [];
    for (const { start, end } of new Polyline(points).segments()) {
      const [low, high] = [Math.min(start.x, end.x), Math.max(start.x, end.x)];
      const [lowY, highY] = [Math.min(start.y, end.y), Math.max(start.y, end.y)];
      if (start.y === end.y && high - low >= label.width / 2) {
        spots.push(...this.onRun(low, high, start.y));
      } else if (start.y !== end.y && highY - lowY >= label.height) {
        spots.push(...this.onDrop(lowY, highY, start.x));
      }
    }
    return spots;
  }

  private at(x: number, y: number): Box {
    return new Box(x, y, this.label.width, this.label.height);
  }

  private onRun(low: number, high: number, y: number): Box[] {
    const { label } = this;
    return LabelSpots.RUN_SPOTS.flatMap((fraction) => {
      const left = Math.round(low + (high - low) * fraction - label.width / 2);
      return [this.at(left, y - label.height - LabelSpots.LINE_GAP), this.at(left, y + LabelSpots.LINE_GAP)];
    });
  }

  private onDrop(low: number, high: number, x: number): Box[] {
    const { label } = this;
    return LabelSpots.DROP_SPOTS.flatMap((fraction) => {
      const top = Math.round(low + (high - low) * fraction - label.height / 2);
      return [this.at(x + LabelSpots.SHAPE_GAP, top), this.at(x - label.width - LabelSpots.SHAPE_GAP, top)];
    });
  }
}
