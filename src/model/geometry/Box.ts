import { Point } from './Point.js';

export class Box {
  constructor(
    public x: number,
    public y: number,
    public width: number,
    public height: number,
  ) {}

  static same(first: Box | undefined, second: Box | undefined, tolerance = 0.5): boolean {
    if (!first || !second) {
      return first === second;
    }
    return (
      Math.abs(first.x - second.x) <= tolerance &&
      Math.abs(first.y - second.y) <= tolerance &&
      Math.abs(first.width - second.width) <= tolerance &&
      Math.abs(first.height - second.height) <= tolerance
    );
  }

  static unionAll(boxes: readonly Box[]): Box | undefined {
    let united: Box | undefined;
    for (const box of boxes) {
      united = united ? united.union(box) : box.copy();
    }
    return united;
  }

  get right(): number {
    return this.x + this.width;
  }

  get bottom(): number {
    return this.y + this.height;
  }

  get center(): Point {
    return new Point(this.x + this.width / 2, this.y + this.height / 2);
  }

  copy(): Box {
    return new Box(this.x, this.y, this.width, this.height);
  }

  overlaps(other: Box, margin = 0): boolean {
    return this.x < other.right + margin && this.right + margin > other.x && this.y < other.bottom + margin && this.bottom + margin > other.y;
  }

  isInside(outer: Box, padding = 0): boolean {
    return this.x >= outer.x + padding - 0.5 && this.y >= outer.y + padding - 0.5 && this.right <= outer.right - padding + 0.5 && this.bottom <= outer.bottom - padding + 0.5;
  }

  contains(point: Point, tolerance = 0): boolean {
    return point.x >= this.x - tolerance && point.x <= this.right + tolerance && point.y >= this.y - tolerance && point.y <= this.bottom + tolerance;
  }

  translate(dx: number, dy: number): void {
    this.x += dx;
    this.y += dy;
  }

  union(other: Box): Box {
    const left = Math.min(this.x, other.x);
    const top = Math.min(this.y, other.y);
    return new Box(left, top, Math.max(this.right, other.right) - left, Math.max(this.bottom, other.bottom) - top);
  }

  grow(by: number): Box {
    return new Box(this.x - by, this.y - by, this.width + 2 * by, this.height + 2 * by);
  }
}
