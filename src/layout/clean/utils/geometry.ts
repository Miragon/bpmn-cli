import type { Box, Point } from '../../../drawing/types.js';
import { segmentsCross } from '../../../drawing/utils/geom.js';
import type { XIndex } from '../XIndex.js';

export type Segment = [Point, Point];

export function toSegments(points: Point[]): Segment[] {
  const out: Segment[] = [];
  for (let i = 0; i + 1 < points.length; i++) out.push([points[i]!, points[i + 1]!]);
  return out;
}

export function dedupe(points: Point[]): Point[] {
  return points.filter((p, i) => i === 0 || p.x !== points[i - 1]!.x || p.y !== points[i - 1]!.y);
}

/** touching a box's own border does not count */
export function hitCount(points: Point[], boxes: Box[] | XIndex<Box>, ignore: Box[]): number {
  let hit: Set<Box> | undefined;
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i]!, b = points[i + 1]!;
    const dx = Math.sign(b.x - a.x), dy = Math.sign(b.y - a.y);
    const ax = a.x + dx * 2, ay = a.y + dy * 2, bx = b.x - dx * 2, by = b.y - dy * 2;
    const x1 = Math.min(ax, bx), x2 = Math.max(ax, bx), y1 = Math.min(ay, by), y2 = Math.max(ay, by);
    const test = (box: Box): void => {
      if (x1 < box.x + box.width && x2 > box.x && y1 < box.y + box.height && y2 > box.y && !ignore.includes(box)) (hit ??= new Set()).add(box);
    };
    if (Array.isArray(boxes)) boxes.forEach(test);
    else boxes.each(x1, x2, test);
  }
  return hit?.size ?? 0;
}

export function pathHits(points: Point[], boxes: Box[] | XIndex<Box>, ignore: Box[]): boolean {
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i]!, b = points[i + 1]!;
    const dx = Math.sign(b.x - a.x), dy = Math.sign(b.y - a.y);
    const ax = a.x + dx * 2, ay = a.y + dy * 2, bx = b.x - dx * 2, by = b.y - dy * 2;
    const x1 = Math.min(ax, bx), x2 = Math.max(ax, bx), y1 = Math.min(ay, by), y2 = Math.max(ay, by);
    const cuts = (box: Box): boolean => x1 < box.x + box.width && x2 > box.x && y1 < box.y + box.height && y2 > box.y && !ignore.includes(box);
    if (Array.isArray(boxes) ? boxes.some(cuts) : boxes.each(x1, x2, cuts)) return true;
  }
  return false;
}

/** shared endpoints and collinear overlaps do not count */
export function properCross([a, b]: Segment, [c, d]: Segment): boolean {
  return segmentsCross(a, b, c, d);
}

export function crossings(points: Point[], lines: Segment[]): number {
  let n = 0;
  for (const a of toSegments(points)) for (const b of lines) if (properCross(a, b)) n++;
  return n;
}
