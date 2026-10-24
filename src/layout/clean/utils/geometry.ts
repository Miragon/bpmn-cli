import type { Box, Point } from '../../../diagram/types.js';
import type { XIndex } from '../XIndex.js';

export type Segment = [Point, Point];

export function bottom(b: Box): number {
  return b.y + b.height;
}

export function right(b: Box): number {
  return b.x + b.width;
}

export function toSegments(points: Point[]): Segment[] {
  const out: Segment[] = [];
  for (let i = 0; i + 1 < points.length; i++) out.push([points[i]!, points[i + 1]!]);
  return out;
}

export function dedupe(points: Point[]): Point[] {
  return points.filter((p, i) => i === 0 || p.x !== points[i - 1]!.x || p.y !== points[i - 1]!.y);
}

/** number of boxes a path cuts through (segment ends shrunk so touching the own border does not count) */
export function hitCount(points: Point[], boxes: Box[] | XIndex<Box>, ignore: Box[]): number {
  let hit: Set<Box> | undefined;
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i]!, b = points[i + 1]!;
    const dx = Math.sign(b.x - a.x), dy = Math.sign(b.y - a.y);
    // the segment shrunk by 2 px at both ends (segmentHitsBox of the shrunk ends)
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

/** Proper crossing of two segments (shared endpoints and collinear overlaps do not count). */
export function properCross([a, b]: Segment, [c, d]: Segment): boolean {
  const o = (p: Point, q: Point, r: Point): number => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  const o1 = o(a, b, c), o2 = o(a, b, d), o3 = o(c, d, a), o4 = o(c, d, b);
  return o1 !== o2 && o3 !== o4 && o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0;
}

export function crossings(points: Point[], lines: Segment[]): number {
  let n = 0;
  for (const a of toSegments(points)) for (const b of lines) if (properCross(a, b)) n++;
  return n;
}
