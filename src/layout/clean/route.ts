import { center, type Box, type Point } from '../../diagram/types.js';
import type { XIndex } from './XIndex.js';
import type { Segment } from './utils/geometry.js';

/** the segment from a to b runs through the inside of `box` (touching its border does not count) */
export function segmentHitsBox(a: Point, b: Point, box: Box): boolean {
  const x1 = Math.min(a.x, b.x), x2 = Math.max(a.x, b.x);
  const y1 = Math.min(a.y, b.y), y2 = Math.max(a.y, b.y);
  return x1 < box.x + box.width && x2 > box.x && y1 < box.y + box.height && y2 > box.y;
}

/** hitCount > 0 (stops at the first box cut) */
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

function orient(a: Point, b: Point, c: Point): number {
  return Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
}

/** proper crossing of two segments (shared endpoints and collinear overlaps do not count) */
export function segmentsCross(s1: Segment, s2: Segment): boolean {
  const [a, b] = s1, [c, d] = s2;
  const o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b);
  return o1 !== o2 && o3 !== o4 && o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0;
}

/** Point on the border of `box` on the line from its centre towards `to`. */
export function borderPoint(box: Box, to: Point): Point {
  const c = center(box);
  const dx = to.x - c.x, dy = to.y - c.y;
  if (dx === 0 && dy === 0) return c;
  const sx = dx !== 0 ? Math.abs((box.width / 2) / dx) : Infinity;
  const sy = dy !== 0 ? Math.abs((box.height / 2) / dy) : Infinity;
  const s = Math.min(sx, sy);
  return { x: c.x + dx * s, y: c.y + dy * s };
}
