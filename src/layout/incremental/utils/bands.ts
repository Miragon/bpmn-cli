import { bottom, cx, cy, right, type Box } from '../../../drawing/utils/geom.js';

export type Axis = 'x' | 'y';

export function near(b: Box, axis: Axis): number {
  return axis === 'x' ? b.x : b.y;
}

export function far(b: Box, axis: Axis): number {
  return axis === 'x' ? right(b) : bottom(b);
}

export function shiftBox(b: Box, axis: Axis, d: number): void {
  if (axis === 'x') b.x += d;
  else b.y += d;
}

export function bandOf(within: Box | undefined, axis: Axis): [number, number] | undefined {
  if (!within) return undefined;
  return axis === 'x' ? [within.y, bottom(within)] : [within.x, right(within)];
}

export function centreInBand(b: Box, band: [number, number] | undefined, axis: Axis): boolean {
  if (!band) return true;
  const c = axis === 'x' ? cy(b) : cx(b);
  return c >= band[0] && c <= band[1];
}

export function overlapsBand(b: Box, band: [number, number] | undefined, axis: Axis): boolean {
  if (!band) return true;
  const lo = axis === 'x' ? b.y : b.x;
  const hi = axis === 'x' ? bottom(b) : right(b);
  return lo < band[1] && hi > band[0];
}

export function pointInBand(p: { x: number; y: number }, band: [number, number] | undefined, axis: Axis): boolean {
  if (!band) return true;
  const c = axis === 'x' ? p.y : p.x;
  return c >= band[0] - 1 && c <= band[1] + 1;
}

export function resize(b: Box, axis: Axis, d: number): void {
  if (axis === 'x') b.width = Math.max(1, b.width + d);
  else b.height = Math.max(1, b.height + d);
}

export function beyondBand(b: Box, band: [number, number] | undefined, axis: Axis): boolean {
  if (!band) return false;
  const lo = axis === 'x' ? b.y : b.x;
  const hi = axis === 'x' ? bottom(b) : right(b);
  return lo < band[0] - 1 || hi > band[1] + 1;
}
