/** Costs, directions and segment helpers the orthogonal router and its grid share. */
import type { Box, Point, Side } from '../di/types.js';
import { bottom, right, segmentsCross } from './geom.js';

export const BEND = 150;
/** a port on a side another connection of the shape takes */
export const AVOID = 100;
export const CROSS = 200;
/** a crossing this close to a line end (its arrowhead, its shape) costs CROSS more */
export const END_ZONE = 25;
export const OVERLAP = 300;
export const HIT = 1_000_000;
export const STUB_TURN = 500;
export const NEAR = 1;
export const MIN_STUB = 15;
export const OVERLAP_TOL = 2;
/** a port off the middle of its side costs base + slope · offset / side length */
export const PORT_OFFSET = 10;
export const PORT_SLOPE = 40;
export const SRC_RANK = [0, 2, 5, 9];
export const TGT_RANK = [0, 1, 4, 8];
export const REGION_PAD = 100;
export const THIN_MARGIN = 3;
export const EPS = 1e-6;

/** 0..3 = right, down, left, up */
export const DX = [1, 0, -1, 0];
export const DY = [0, 1, 0, -1];
export const OUTWARD: Record<Side, number> = { right: 0, bottom: 1, left: 2, top: 3 };

/** The router's crossing cost uses the same test. */
export function crossings(points: readonly Point[], lines: readonly Point[][]): number {
  let crossings = 0;
  for (let index = 0; index + 1 < points.length; index++) {
    for (const line of lines) {
      for (let segmentIndex = 0; segmentIndex + 1 < line.length; segmentIndex++) {
        if (segmentsCross(points[index]!, points[index + 1]!, line[segmentIndex]!, line[segmentIndex + 1]!)) {
          crossings++;
        }
      }
    }
  }
  return crossings;
}

/** Drops collinear points; ports on one spot keep both ends, so never fewer than two points. */
export function simplify(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const point of points) {
    const last = out[out.length - 1];
    if (last && last.x === point.x && last.y === point.y) continue;
    const prev = out[out.length - 2];
    if (prev && last && ((prev.x === last.x && last.x === point.x) || (prev.y === last.y && last.y === point.y))) {
      out.pop();
    }
    out.push({ x: point.x, y: point.y });
  }
  if (out.length === 1 && points.length > 1) out.push({ ...out[0]! });
  return out;
}

export interface Port {
  x: number;
  y: number;
  side: Side;
  cost: number;
}

export function span(box: Box, side: Side): [number, number] {
  return side === 'left' || side === 'right' ? [box.y, bottom(box)] : [box.x, right(box)];
}

export function pointOn(box: Box, side: Side, progress: number): Point {
  switch (side) {
    case 'left':
      return { x: box.x, y: progress };
    case 'right':
      return { x: right(box), y: progress };
    case 'top':
      return { x: progress, y: box.y };
    case 'bottom':
      return { x: progress, y: bottom(box) };
  }
}

export interface Seg {
  start: Point;
  end: Point;
  kind: 'h' | 'v' | 'd';
  ends?: Point[];
  /** on the shared tail into a join's top / bottom port: following it there is no overlap */
  merge?: boolean;
}
