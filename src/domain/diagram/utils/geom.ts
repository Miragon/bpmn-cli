/** Pure geometry on plain boxes and points in diagram pixels, y growing downwards. */
import type { Box, Point } from '../di/types.js';

export type { Box, Point };

export function center(box: Box): Point {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export const right = (box: Box): number => box.x + box.width;
export const bottom = (box: Box): number => box.y + box.height;
export const cx = (box: Box): number => box.x + box.width / 2;
export const cy = (box: Box): number => box.y + box.height / 2;

export function copyBox(box: Box): Box {
  return { x: box.x, y: box.y, width: box.width, height: box.height };
}

export function copyPoints(pts: readonly Point[]): Point[] {
  return pts.map((point) => ({ x: point.x, y: point.y }));
}

export function sameBox(first: Box | undefined, second: Box | undefined, tol = 0.5): boolean {
  if (!first || !second) return first === second;
  return Math.abs(first.x - second.x) <= tol && Math.abs(first.y - second.y) <= tol && Math.abs(first.width - second.width) <= tol && Math.abs(first.height - second.height) <= tol;
}

export function samePoints(first: readonly Point[], second: readonly Point[], tol = 0.5): boolean {
  return first.length === second.length && first.every((point, index) => Math.abs(point.x - second[index]!.x) <= tol && Math.abs(point.y - second[index]!.y) <= tol);
}

/** Closer than `margin` on both axes; with margin 0 they share interior. */
export function overlaps(first: Box, second: Box, margin = 0): boolean {
  return first.x < right(second) + margin && right(first) + margin > second.x && first.y < bottom(second) + margin && bottom(first) + margin > second.y;
}

export function inside(inner: Box, outer: Box, pad = 0): boolean {
  return inner.x >= outer.x + pad - 0.5 && inner.y >= outer.y + pad - 0.5 && right(inner) <= right(outer) - pad + 0.5 && bottom(inner) <= bottom(outer) - pad + 0.5;
}

export function containsPoint(box: Box, point: Point, tol = 0): boolean {
  return point.x >= box.x - tol && point.x <= right(box) + tol && point.y >= box.y - tol && point.y <= bottom(box) + tol;
}

export function equalBoxes(first: Box, second: Box): boolean {
  return first.x === second.x && first.y === second.y && first.width === second.width && first.height === second.height;
}

export function union(first: Box, second: Box): Box {
  const left = Math.min(first.x, second.x);
  const top = Math.min(first.y, second.y);
  return { x: left, y: top, width: Math.max(right(first), right(second)) - left, height: Math.max(bottom(first), bottom(second)) - top };
}

export function unionAll(boxes: readonly Box[]): Box | undefined {
  let out: Box | undefined;
  for (const box of boxes) out = out ? union(out, box) : copyBox(box);
  return out;
}

export function translate(at: Point, dx: number, dy: number): void {
  at.x += dx;
  at.y += dy;
}

export function translatePoints(points: readonly Point[], dx: number, dy: number): void {
  for (const point of points) translate(point, dx, dy);
}

export function translateShape(shape: { bounds: Box; label?: Box | undefined }, dx: number, dy: number): void {
  translate(shape.bounds, dx, dy);
  if (shape.label) translate(shape.label, dx, dy);
}

export function translateEdge(edge: { points: Point[]; label?: Box | undefined }, dx: number, dy: number): void {
  translatePoints(edge.points, dx, dy);
  if (edge.label) translate(edge.label, dx, dy);
}

export function grow(box: Box, by: number): Box {
  return { x: box.x - by, y: box.y - by, width: box.width + 2 * by, height: box.height + 2 * by };
}

function slab(origin: number, direction: number, lo: number, hi: number): [number, number] {
  const lowExit = (lo - origin) / direction;
  const highExit = (hi - origin) / direction;
  return lowExit < highExit ? [lowExit, highExit] : [highExit, lowExit];
}

/**
 * A diagonal segment is clipped against the box (Liang-Barsky),
 * so a straight association passing beside a shape does not hit it.
 */
export function segmentHits(start: Point, end: Point, box: Box, shrink = 2): boolean {
  const boxHit = Math.min(start.x, end.x) < right(box) - shrink && Math.max(start.x, end.x) > box.x + shrink && Math.min(start.y, end.y) < bottom(box) - shrink && Math.max(start.y, end.y) > box.y + shrink;
  if (!boxHit || start.x === end.x || start.y === end.y) return boxHit;
  if (right(box) - shrink <= box.x + shrink || bottom(box) - shrink <= box.y + shrink) return false;
  const [ax, bx] = slab(start.x, end.x - start.x, box.x + shrink, right(box) - shrink);
  const [ay, by] = slab(start.y, end.y - start.y, box.y + shrink, bottom(box) - shrink);
  const lo = Math.max(ax, ay);
  const hi = Math.min(bx, by);
  return lo < hi && lo < 1 && hi > 0;
}

/** Touching the border does not count. */
export function segmentHitsBox(start: Point, end: Point, box: Box): boolean {
  return Math.min(start.x, end.x) < right(box) && Math.max(start.x, end.x) > box.x && Math.min(start.y, end.y) < bottom(box) && Math.max(start.y, end.y) > box.y;
}

const orient = (first: Point, second: Point, third: Point): number => Math.sign((second.x - first.x) * (third.y - first.y) - (second.y - first.y) * (third.x - first.x));

/** Shared end points, T-junctions and collinear runs are no proper crossing. */
export function segmentsCross(firstStart: Point, firstEnd: Point, secondStart: Point, secondEnd: Point): boolean {
  const o1 = orient(firstStart, firstEnd, secondStart);
  const o2 = orient(firstStart, firstEnd, secondEnd);
  const o3 = orient(secondStart, secondEnd, firstStart);
  const o4 = orient(secondStart, secondEnd, firstEnd);
  return o1 !== o2 && o3 !== o4 && !!o1 && !!o2 && !!o3 && !!o4;
}

export function polylinesCross(first: readonly Point[], second: readonly Point[]): boolean {
  for (let firstIndex = 0; firstIndex + 1 < first.length; firstIndex++) {
    for (let secondIndex = 0; secondIndex + 1 < second.length; secondIndex++) if (segmentsCross(first[firstIndex]!, first[firstIndex + 1]!, second[secondIndex]!, second[secondIndex + 1]!)) return true;
  }
  return false;
}

export function pathHits(points: readonly Point[], box: Box, shrink = 2): boolean {
  for (let index = 0; index + 1 < points.length; index++) if (segmentHits(points[index]!, points[index + 1]!, box, shrink)) return true;
  return false;
}

export function isOrthogonal(points: readonly Point[], tol = 0.5): boolean {
  for (let index = 0; index + 1 < points.length; index++) {
    const start = points[index]!;
    const end = points[index + 1]!;
    if (Math.abs(start.x - end.x) > tol && Math.abs(start.y - end.y) > tol) return false;
  }
  return true;
}

/** Positive inside and outside. */
export function borderDistance(box: Box, point: Point): number {
  const dx = Math.max(box.x - point.x, 0, point.x - right(box));
  const dy = Math.max(box.y - point.y, 0, point.y - bottom(box));
  if (dx > 0 || dy > 0) return Math.hypot(dx, dy);
  return Math.min(point.x - box.x, right(box) - point.x, point.y - box.y, bottom(box) - point.y);
}

export function median(values: readonly number[]): number | undefined {
  if (!values.length) return undefined;
  const sorted = [...values].sort((first, second) => first - second);
  const middleIndex = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middleIndex]! : (sorted[middleIndex - 1]! + sorted[middleIndex]!) / 2;
}

export function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

export function borderPoint(box: Box, to: Point): Point {
  const middle = { x: cx(box), y: cy(box) };
  const dx = to.x - middle.x;
  const dy = to.y - middle.y;
  if (!dx && !dy) return middle;
  const sx = dx ? Math.abs(box.width / 2 / dx) : Infinity;
  const sy = dy ? Math.abs(box.height / 2 / dy) : Infinity;
  const scale = Math.min(sx, sy);
  return { x: middle.x + dx * scale, y: middle.y + dy * scale };
}

/** Fewer than two distinct points once rounded to whole pixels. */
export function degenerate(pts: readonly Point[]): boolean {
  return roundPoints(pts).length < 2;
}

export function roundPoints(pts: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (const point of pts) {
    const rounded = { x: Math.round(point.x), y: Math.round(point.y) };
    const last = out[out.length - 1];
    if (!last || last.x !== rounded.x || last.y !== rounded.y) out.push(rounded);
  }
  return out;
}
