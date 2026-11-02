import type { Box } from './Box.js';
import { Point } from './Point.js';

export class BoxBorder {
  constructor(private readonly box: Box) {}

  distanceTo(point: Point): number {
    const { box } = this;
    const dx = Math.max(box.x - point.x, 0, point.x - box.right);
    const dy = Math.max(box.y - point.y, 0, point.y - box.bottom);
    if (dx > 0 || dy > 0) {
      return Math.hypot(dx, dy);
    }
    return Math.min(point.x - box.x, box.right - point.x, point.y - box.y, box.bottom - point.y);
  }

  pointTowards(target: Point): Point {
    const { box } = this;
    const middle = box.center;
    const dx = target.x - middle.x;
    const dy = target.y - middle.y;
    if (!dx && !dy) {
      return middle;
    }
    const scaleX = dx ? Math.abs(box.width / 2 / dx) : Number.POSITIVE_INFINITY;
    const scaleY = dy ? Math.abs(box.height / 2 / dy) : Number.POSITIVE_INFINITY;
    const scale = Math.min(scaleX, scaleY);
    return new Point(middle.x + dx * scale, middle.y + dy * scale);
  }
}
