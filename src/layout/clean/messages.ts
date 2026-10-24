import type { Point } from '../../diagram/types.js';
import { toSegments as segs, type Segment as Seg } from './utils/geometry.js';

/** Proper crossing of two segments (shared endpoints and collinear overlaps do not count). */
export function properCross([a, b]: Seg, [c, d]: Seg): boolean {
  const o = (p: Point, q: Point, r: Point): number => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  const o1 = o(a, b, c), o2 = o(a, b, d), o3 = o(c, d, a), o4 = o(c, d, b);
  return o1 !== o2 && o3 !== o4 && o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0;
}

export function crossings(points: Point[], lines: Seg[]): number {
  let n = 0;
  for (const a of segs(points)) for (const b of lines) if (properCross(a, b)) n++;
  return n;
}
