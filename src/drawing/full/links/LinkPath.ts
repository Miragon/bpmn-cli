import { Polyline, type Box, type Point, type Segment } from '../../../model/index.js';

export class LinkPath {
  static readonly HUG = 5;

  private static readonly NEAR = 6;

  private readonly legs: Segment[];

  constructor(readonly points: readonly Point[]) {
    this.legs = new Polyline(points).segments();
  }

  private static overlap(firstLow: number, firstHigh: number, secondLow: number, secondHigh: number): number {
    return Math.min(Math.max(firstLow, firstHigh), Math.max(secondLow, secondHigh)) - Math.max(Math.min(firstLow, firstHigh), Math.min(secondLow, secondHigh));
  }

  private static sideBySide({ start, end }: Segment, line: Segment, from: number): number {
    const apart = (first: number, second: number): boolean => Math.abs(first - second) >= from && Math.abs(first - second) <= LinkPath.NEAR;
    const [lineStart, lineEnd] = [line.start, line.end];
    if (start.y === end.y && lineStart.y === lineEnd.y && apart(start.y, lineStart.y)) {
      return LinkPath.overlap(start.x, end.x, lineStart.x, lineEnd.x);
    }
    if (start.x === end.x && lineStart.x === lineEnd.x && apart(start.x, lineStart.x)) {
      return LinkPath.overlap(start.y, end.y, lineStart.y, lineEnd.y);
    }
    return 0;
  }

  private static runsAlong({ start, end }: Segment, box: Box): boolean {
    const hug = LinkPath.HUG;
    if (start.y === end.y) {
      return (Math.abs(start.y - box.y) <= hug || Math.abs(start.y - box.bottom) <= hug) && Math.min(start.x, end.x) < box.right && Math.max(start.x, end.x) > box.x;
    }
    return start.x === end.x && (Math.abs(start.x - box.x) <= hug || Math.abs(start.x - box.right) <= hug) && Math.min(start.y, end.y) < box.bottom && Math.max(start.y, end.y) > box.y;
  }

  length(): number {
    return this.legs.reduce((sum, { start, end }) => sum + Math.abs(end.x - start.x) + Math.abs(end.y - start.y), 0);
  }

  isDiagonal(): boolean {
    const [first, second] = this.points;
    return this.points.length === 2 && first!.x !== second!.x && first!.y !== second!.y;
  }

  runsAlongLines(lines: readonly Segment[], from = 0): boolean {
    return this.legs.some((leg) => lines.some((line) => LinkPath.sideBySide(leg, line, from) > 0));
  }

  hugsBorders(shapes: readonly Box[], from: Box, to: Box, borders: readonly number[]): boolean {
    return this.legs.some((leg, index) => {
      if (leg.start.y === leg.end.y && borders.some((y) => Math.abs(leg.start.y - y) <= LinkPath.HUG)) {
        return true;
      }
      return shapes.some((box) => !(box === from && index === 0) && !(box === to && index === this.legs.length - 1) && LinkPath.runsAlong(leg, box));
    });
  }
}
