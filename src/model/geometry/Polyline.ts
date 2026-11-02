import type { Box } from './Box.js';
import { Point } from './Point.js';
import { Segment } from './Segment.js';

interface BoxesByX {
  each(low: number, high: number, visit: (box: Box) => boolean | void): boolean;
}

export type BoxSource = readonly Box[] | BoxesByX;

interface Span {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export class Polyline {
  constructor(readonly points: readonly Point[]) {}

  private static innerSpan({ start, end }: Segment): Span {
    const dx = Math.sign(end.x - start.x);
    const dy = Math.sign(end.y - start.y);
    const [startX, startY, endX, endY] = [start.x + dx * 2, start.y + dy * 2, end.x - dx * 2, end.y - dy * 2];
    return { left: Math.min(startX, endX), right: Math.max(startX, endX), top: Math.min(startY, endY), bottom: Math.max(startY, endY) };
  }

  private static cuts(span: Span, box: Box): boolean {
    return span.left < box.x + box.width && span.right > box.x && span.top < box.y + box.height && span.bottom > box.y;
  }

  private static isList(boxes: BoxSource): boxes is readonly Box[] {
    return Array.isArray(boxes);
  }

  segments(): Segment[] {
    return this.points.slice(1).map((point, index) => new Segment(this.points[index]!, point));
  }

  copy(): Point[] {
    return this.points.map((point) => point.copy());
  }

  same(other: Polyline, tolerance = 0.5): boolean {
    return (
      this.points.length === other.points.length &&
      this.points.every((point, index) => Math.abs(point.x - other.points[index]!.x) <= tolerance && Math.abs(point.y - other.points[index]!.y) <= tolerance)
    );
  }

  translate(dx: number, dy: number): void {
    for (const point of this.points) {
      point.translate(dx, dy);
    }
  }

  crosses(other: Polyline): boolean {
    const theirs = other.segments();
    return this.segments().some((segment) => theirs.some((their) => segment.crosses(their)));
  }

  hits(box: Box, shrink = 2): boolean {
    return this.segments().some((segment) => segment.hits(box, shrink));
  }

  hitCount(boxes: BoxSource, ignore: readonly Box[]): number {
    const hit = new Set<Box>();
    for (const segment of this.segments()) {
      const span = Polyline.innerSpan(segment);
      const test = (box: Box): void => {
        if (Polyline.cuts(span, box) && !ignore.includes(box)) {
          hit.add(box);
        }
      };
      if (Polyline.isList(boxes)) {
        boxes.forEach(test);
      } else {
        boxes.each(span.left, span.right, test);
      }
    }
    return hit.size;
  }

  hitsAny(boxes: BoxSource, ignore: readonly Box[]): boolean {
    return this.segments().some((segment) => {
      const span = Polyline.innerSpan(segment);
      const cuts = (box: Box): boolean => Polyline.cuts(span, box) && !ignore.includes(box);
      return Polyline.isList(boxes) ? boxes.some(cuts) : boxes.each(span.left, span.right, cuts);
    });
  }

  isOrthogonal(tolerance = 0.5): boolean {
    return this.segments().every(({ start, end }) => Math.abs(start.x - end.x) <= tolerance || Math.abs(start.y - end.y) <= tolerance);
  }

  crossingCount(lines: readonly Polyline[]): number {
    const theirs = lines.flatMap((line) => line.segments());
    return this.segments().reduce((sum, segment) => sum + theirs.filter((their) => segment.crosses(their)).length, 0);
  }

  simplified(): Point[] {
    const kept: Point[] = [];
    for (const point of this.deduped()) {
      const [previous, last] = [kept.at(-2), kept.at(-1)];
      if (previous && last && ((previous.x === last.x && last.x === point.x) || (previous.y === last.y && last.y === point.y))) {
        kept.pop();
      }
      kept.push(point.copy());
    }
    return kept.length === 1 && this.points.length > 1 ? [kept[0]!, kept[0]!.copy()] : kept;
  }

  private deduped(): Point[] {
    return this.points.filter((point, index) => index === 0 || point.x !== this.points[index - 1]!.x || point.y !== this.points[index - 1]!.y);
  }

  rounded(): Point[] {
    const rounded = this.points.map((point) => new Point(Math.round(point.x), Math.round(point.y)));
    return new Polyline(rounded).deduped();
  }
}
