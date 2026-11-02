import type { Box } from './Box.js';
import type { Point } from './Point.js';

export class Segment {
  constructor(
    readonly start: Point,
    readonly end: Point,
  ) {}

  private static orientation(first: Point, second: Point, third: Point): number {
    return Math.sign((second.x - first.x) * (third.y - first.y) - (second.y - first.y) * (third.x - first.x));
  }

  private static slab(origin: number, direction: number, low: number, high: number): [number, number] {
    const lowExit = (low - origin) / direction;
    const highExit = (high - origin) / direction;
    return lowExit < highExit ? [lowExit, highExit] : [highExit, lowExit];
  }

  *[Symbol.iterator](): Generator<Point> {
    yield this.start;
    yield this.end;
  }

  hits(box: Box, shrink = 2): boolean {
    const { start, end } = this;
    const boxHit = this.hitsBounds(box, shrink);
    if (!boxHit || start.x === end.x || start.y === end.y) {
      return boxHit;
    }
    if (box.right - shrink <= box.x + shrink || box.bottom - shrink <= box.y + shrink) {
      return false;
    }
    const [enterX, leaveX] = Segment.slab(start.x, end.x - start.x, box.x + shrink, box.right - shrink);
    const [enterY, leaveY] = Segment.slab(start.y, end.y - start.y, box.y + shrink, box.bottom - shrink);
    const enter = Math.max(enterX, enterY);
    const leave = Math.min(leaveX, leaveY);
    return enter < leave && enter < 1 && leave > 0;
  }

  hitsBounds(box: Box, shrink = 0): boolean {
    const { start, end } = this;
    return Math.min(start.x, end.x) < box.right - shrink && Math.max(start.x, end.x) > box.x + shrink && Math.min(start.y, end.y) < box.bottom - shrink && Math.max(start.y, end.y) > box.y + shrink;
  }

  crosses(other: Segment): boolean {
    const first = Segment.orientation(this.start, this.end, other.start);
    const second = Segment.orientation(this.start, this.end, other.end);
    const third = Segment.orientation(other.start, other.end, this.start);
    const fourth = Segment.orientation(other.start, other.end, this.end);
    return first !== second && third !== fourth && !!first && !!second && !!third && !!fourth;
  }
}
