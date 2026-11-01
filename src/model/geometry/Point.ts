export class Point {
  constructor(
    public x: number,
    public y: number,
  ) {}

  translate(dx: number, dy: number): void {
    this.x += dx;
    this.y += dy;
  }

  copy(): Point {
    return new Point(this.x, this.y);
  }
}
