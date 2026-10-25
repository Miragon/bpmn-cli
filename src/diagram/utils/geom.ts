/** Pure geometry on plain boxes and points in diagram pixels, y growing downwards. */
import type { Box, Point } from '../types.js';

export type { Box, Point };

export function center(b: Box): Point {
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

export function boxesOverlap(a: Box, b: Box, margin = 0): boolean {
  return a.x < b.x + b.width + margin && a.x + a.width + margin > b.x && a.y < b.y + b.height + margin && a.y + a.height + margin > b.y;
}

export const right = (b: Box): number => b.x + b.width;
export const bottom = (b: Box): number => b.y + b.height;
export const cx = (b: Box): number => b.x + b.width / 2;
export const cy = (b: Box): number => b.y + b.height / 2;

export function copyBox(b: Box): Box {
  return { x: b.x, y: b.y, width: b.width, height: b.height };
}

export function copyPoints(pts: readonly Point[]): Point[] {
  return pts.map((p) => ({ x: p.x, y: p.y }));
}

export function sameBox(a: Box | undefined, b: Box | undefined, tol = 0.5): boolean {
  if (!a || !b) return a === b;
  return Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol && Math.abs(a.width - b.width) <= tol && Math.abs(a.height - b.height) <= tol;
}

export function samePoints(a: readonly Point[], b: readonly Point[], tol = 0.5): boolean {
  return a.length === b.length && a.every((p, i) => Math.abs(p.x - b[i]!.x) <= tol && Math.abs(p.y - b[i]!.y) <= tol);
}

/** Closer than `margin` on both axes; with margin 0 they share interior. */
export function overlaps(a: Box, b: Box, margin = 0): boolean {
  return a.x < right(b) + margin && right(a) + margin > b.x && a.y < bottom(b) + margin && bottom(a) + margin > b.y;
}

export function inside(inner: Box, outer: Box, pad = 0): boolean {
  return inner.x >= outer.x + pad - 0.5 && inner.y >= outer.y + pad - 0.5 && right(inner) <= right(outer) - pad + 0.5 && bottom(inner) <= bottom(outer) - pad + 0.5;
}

export function containsPoint(b: Box, p: Point, tol = 0): boolean {
  return p.x >= b.x - tol && p.x <= right(b) + tol && p.y >= b.y - tol && p.y <= bottom(b) + tol;
}

export function equalBoxes(a: Box, b: Box): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

export function union(a: Box, b: Box): Box {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(right(a), right(b)) - x, height: Math.max(bottom(a), bottom(b)) - y };
}

export function unionAll(boxes: readonly Box[]): Box | undefined {
  let out: Box | undefined;
  for (const b of boxes) out = out ? union(out, b) : copyBox(b);
  return out;
}

export function grow(b: Box, by: number): Box {
  return { x: b.x - by, y: b.y - by, width: b.width + 2 * by, height: b.height + 2 * by };
}

export function translate(b: Box, dx: number, dy: number): void {
  b.x += dx;
  b.y += dy;
}

function slab(p: number, d: number, lo: number, hi: number): [number, number] {
  const a = (lo - p) / d;
  const b = (hi - p) / d;
  return a < b ? [a, b] : [b, a];
}

/**
 * A diagonal segment is clipped against the box (Liang-Barsky),
 * so a straight association passing beside a shape does not hit it.
 */
export function segmentHits(p: Point, q: Point, b: Box, shrink = 2): boolean {
  const boxHit = Math.min(p.x, q.x) < right(b) - shrink && Math.max(p.x, q.x) > b.x + shrink && Math.min(p.y, q.y) < bottom(b) - shrink && Math.max(p.y, q.y) > b.y + shrink;
  if (!boxHit || p.x === q.x || p.y === q.y) return boxHit;
  if (right(b) - shrink <= b.x + shrink || bottom(b) - shrink <= b.y + shrink) return false;
  const [ax, bx] = slab(p.x, q.x - p.x, b.x + shrink, right(b) - shrink);
  const [ay, by] = slab(p.y, q.y - p.y, b.y + shrink, bottom(b) - shrink);
  const lo = Math.max(ax, ay);
  const hi = Math.min(bx, by);
  return lo < hi && lo < 1 && hi > 0;
}

/** Touching the border does not count. */
export function segmentHitsBox(a: Point, b: Point, box: Box): boolean {
  return Math.min(a.x, b.x) < right(box) && Math.max(a.x, b.x) > box.x && Math.min(a.y, b.y) < bottom(box) && Math.max(a.y, b.y) > box.y;
}

const orient = (a: Point, b: Point, c: Point): number => Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));

/** Shared end points, T-junctions and collinear runs are no proper crossing. */
export function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  return o1 !== o2 && o3 !== o4 && !!o1 && !!o2 && !!o3 && !!o4;
}

export function polylinesCross(a: readonly Point[], b: readonly Point[]): boolean {
  for (let i = 0; i + 1 < a.length; i++) {
    for (let j = 0; j + 1 < b.length; j++) if (segmentsCross(a[i]!, a[i + 1]!, b[j]!, b[j + 1]!)) return true;
  }
  return false;
}

export function pathHits(points: readonly Point[], b: Box, shrink = 2): boolean {
  for (let i = 0; i + 1 < points.length; i++) if (segmentHits(points[i]!, points[i + 1]!, b, shrink)) return true;
  return false;
}

export function isOrthogonal(points: readonly Point[], tol = 0.5): boolean {
  for (let i = 0; i + 1 < points.length; i++) {
    const p = points[i]!;
    const q = points[i + 1]!;
    if (Math.abs(p.x - q.x) > tol && Math.abs(p.y - q.y) > tol) return false;
  }
  return true;
}

/** Positive inside and outside. */
export function borderDistance(b: Box, p: Point): number {
  const dx = Math.max(b.x - p.x, 0, p.x - right(b));
  const dy = Math.max(b.y - p.y, 0, p.y - bottom(b));
  if (dx > 0 || dy > 0) return Math.hypot(dx, dy);
  return Math.min(p.x - b.x, right(b) - p.x, p.y - b.y, bottom(b) - p.y);
}

export function median(values: readonly number[]): number | undefined {
  if (!values.length) return undefined;
  const s = [...values].sort((a, b) => a - b);
  const k = s.length >> 1;
  return s.length % 2 ? s[k]! : (s[k - 1]! + s[k]!) / 2;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function borderPoint(b: Box, to: Point): Point {
  const c = { x: cx(b), y: cy(b) };
  const dx = to.x - c.x;
  const dy = to.y - c.y;
  if (!dx && !dy) return c;
  const sx = dx ? Math.abs(b.width / 2 / dx) : Infinity;
  const sy = dy ? Math.abs(b.height / 2 / dy) : Infinity;
  const s = Math.min(sx, sy);
  return { x: c.x + dx * s, y: c.y + dy * s };
}

/** Fewer than two distinct points once rounded to whole pixels. */
export function degenerate(pts: readonly Point[]): boolean {
  return roundPoints(pts).length < 2;
}

export function roundPoints(pts: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (const p of pts) {
    const q = { x: Math.round(p.x), y: Math.round(p.y) };
    const last = out[out.length - 1];
    if (!last || last.x !== q.x || last.y !== q.y) out.push(q);
  }
  return out;
}
