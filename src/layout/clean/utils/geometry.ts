import type { Box, Point } from '../../../drawing/types.js';
import { segmentsCross } from '../../../drawing/utils/geom.js';
import type { XIndex } from '../XIndex.js';

export type Segment = [Point, Point];

export function toSegments(points: Point[]): Segment[] {
  const out: Segment[] = [];
  for (let index = 0; index + 1 < points.length; index++) out.push([points[index]!, points[index + 1]!]);
  return out;
}

export function dedupe(points: Point[]): Point[] {
  return points.filter((point, index) => index === 0 || point.x !== points[index - 1]!.x || point.y !== points[index - 1]!.y);
}

/** touching a box's own border does not count */
export function hitCount(points: Point[], boxes: Box[] | XIndex<Box>, ignore: Box[]): number {
  let hit: Set<Box> | undefined;
  for (let index = 0; index + 1 < points.length; index++) {
    const start = points[index]!, end = points[index + 1]!;
    const dx = Math.sign(end.x - start.x), dy = Math.sign(end.y - start.y);
    const ax = start.x + dx * 2, ay = start.y + dy * 2, bx = end.x - dx * 2, by = end.y - dy * 2;
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
  for (let index = 0; index + 1 < points.length; index++) {
    const start = points[index]!, end = points[index + 1]!;
    const dx = Math.sign(end.x - start.x), dy = Math.sign(end.y - start.y);
    const ax = start.x + dx * 2, ay = start.y + dy * 2, bx = end.x - dx * 2, by = end.y - dy * 2;
    const x1 = Math.min(ax, bx), x2 = Math.max(ax, bx), y1 = Math.min(ay, by), y2 = Math.max(ay, by);
    const cuts = (box: Box): boolean => x1 < box.x + box.width && x2 > box.x && y1 < box.y + box.height && y2 > box.y && !ignore.includes(box);
    if (Array.isArray(boxes) ? boxes.some(cuts) : boxes.each(x1, x2, cuts)) return true;
  }
  return false;
}

/** shared endpoints and collinear overlaps do not count */
export function properCross([firstStart, firstEnd]: Segment, [secondStart, secondEnd]: Segment): boolean {
  return segmentsCross(firstStart, firstEnd, secondStart, secondEnd);
}

export function crossings(points: Point[], lines: Segment[]): number {
  let count = 0;
  for (const segment of toSegments(points)) for (const line of lines) if (properCross(segment, line)) count++;
  return count;
}
