export interface Point {
  x: number;
  y: number;
}

export class Box {
  constructor(
    readonly x: number,
    readonly y: number,
    readonly width: number,
    readonly height: number,
  ) {}

  static around(boxes: readonly Box[]): Box | undefined {
    return boxes.reduce<Box | undefined>((union, box) => (union ? union.union(box) : box), undefined);
  }

  static spanning(points: readonly Point[]): Box | undefined {
    return Box.around(points.map((point) => new Box(point.x, point.y, 0, 0)));
  }

  get right(): number {
    return this.x + this.width;
  }

  get bottom(): number {
    return this.y + this.height;
  }

  get centerX(): number {
    return this.x + this.width / 2;
  }

  get centerY(): number {
    return this.y + this.height / 2;
  }

  grown(by: number): Box {
    return new Box(this.x - by, this.y - by, this.width + 2 * by, this.height + 2 * by);
  }

  union(other: Box): Box {
    const left = Math.min(this.x, other.x);
    const top = Math.min(this.y, other.y);
    return new Box(left, top, Math.max(this.right, other.right) - left, Math.max(this.bottom, other.bottom) - top);
  }

  meets(other: Box): boolean {
    return this.x <= other.right && other.x <= this.right && this.y <= other.bottom && other.y <= this.bottom;
  }

  contains(point: Point): boolean {
    return point.x >= this.x && point.x <= this.right && point.y >= this.y && point.y <= this.bottom;
  }
}
