/**
 * The costs, directions and segment helpers the orthogonal router and its
 * grid share (src/diagram/OrthogonalRouter.ts, src/diagram/RouteGrid.ts);
 * crossings(points, lines) counts a route's proper crossings with `lines`
 * (the test of the router's cost).
 */
import type { Box, Point, Side } from '../types.js';
import { bottom, right } from './geom.js';

export const BEND = 150;
/** a port on a side to avoid (taken by another connection of the shape) */
export const AVOID = 100;
export const CROSS = 200;
/** a crossing this close to the start / end of a line (its arrowhead, its shape) costs CROSS more */
export const END_ZONE = 25;
export const OVERLAP = 300;
export const HIT = 1_000_000;
export const STUB_TURN = 500;
/** extra cost per px of a grid edge inside an obstacle's margin */
export const NEAR = 1;
export const MIN_STUB = 15;
/** distance under which two parallel segments count as running on top of each other */
export const OVERLAP_TOL = 2;
/** cost of a port off the middle of its side: base + slope · offset / side length */
export const PORT_OFFSET = 10;
export const PORT_SLOPE = 40;
/** tie-break cost of the k-th allowed side */
export const SRC_RANK = [0, 2, 5, 9];
export const TGT_RANK = [0, 1, 4, 8];
/** the search region: bounding box of source and target plus this padding */
export const REGION_PAD = 100;
/** margin of the last-resort search through narrow gaps */
export const THIN_MARGIN = 3;
export const EPS = 1e-6;

/** travel direction 0..3 = right, down, left, up */
export const DX = [1, 0, -1, 0];
export const DY = [0, 1, 0, -1];
export const OUTWARD: Record<Side, number> = { right: 0, bottom: 1, left: 2, top: 3 };

function orient(a: Point, b: Point, c: Point): number {
  return Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
}

/** proper crossing (shared endpoints, T-junctions and collinear runs do not count) */
export function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b);
  return o1 * o2 < 0 && o3 * o4 < 0;
}

/** Proper crossings of a route with `lines` (the test of the cost: shared end points, T-junctions and collinear runs do not count). */
export function crossings(points: readonly Point[], lines: readonly Point[][]): number {
  let n = 0;
  for (let i = 0; i + 1 < points.length; i++) {
    for (const line of lines) for (let k = 0; k + 1 < line.length; k++) if (segmentsCross(points[i]!, points[i + 1]!, line[k]!, line[k + 1]!)) n++;
  }
  return n;
}

/** drop duplicate points and interior points on a straight run */
export function simplify(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && last.x === p.x && last.y === p.y) continue;
    const prev = out[out.length - 2];
    if (prev && last && ((prev.x === last.x && last.x === p.x) || (prev.y === last.y && last.y === p.y))) out.pop();
    out.push({ x: p.x, y: p.y });
  }
  // never fewer than two points (the contract): ports on one spot keep both ends
  if (out.length === 1 && points.length > 1) out.push({ ...out[0]! });
  return out;
}

export interface Port {
  x: number;
  y: number;
  side: Side;
  /** tie-break cost (side preference, offset from the middle) */
  cost: number;
}

/** the range a side covers along its own axis (y for left/right, x for top/bottom) */
export function span(b: Box, side: Side): [number, number] {
  return side === 'left' || side === 'right' ? [b.y, bottom(b)] : [b.x, right(b)];
}

export function pointOn(b: Box, side: Side, t: number): Point {
  switch (side) {
    case 'left':
      return { x: b.x, y: t };
    case 'right':
      return { x: right(b), y: t };
    case 'top':
      return { x: t, y: b.y };
    case 'bottom':
      return { x: t, y: bottom(b) };
  }
}

export interface Seg {
  a: Point;
  b: Point;
  kind: 'h' | 'v' | 'd';
  /** the line's start / end when they lie on this segment (its first / last one) */
  ends?: Point[];
  /** part of the shared tail of a line into a top / bottom target port (targetMerge): following it into the port is no overlap */
  merge?: boolean;
}
