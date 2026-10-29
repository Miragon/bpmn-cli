import { bottom, cx, cy, right, type Box } from './geom.js';

export type Axis = 'x' | 'y';

export function near(box: Box, axis: Axis): number {
  return axis === 'x' ? box.x : box.y;
}

export function far(box: Box, axis: Axis): number {
  return axis === 'x' ? right(box) : bottom(box);
}

export function shiftBox(box: Box, axis: Axis, delta: number): void {
  if (axis === 'x') {
    box.x += delta;
  } else {
    box.y += delta;
  }
}

export function bandOf(within: Box | undefined, axis: Axis): [number, number] | undefined {
  if (!within) return undefined;
  return axis === 'x' ? [within.y, bottom(within)] : [within.x, right(within)];
}

export function centreInBand(box: Box, band: [number, number] | undefined, axis: Axis): boolean {
  if (!band) return true;
  const center = axis === 'x' ? cy(box) : cx(box);
  return center >= band[0] && center <= band[1];
}

export function overlapsBand(box: Box, band: [number, number] | undefined, axis: Axis): boolean {
  if (!band) return true;
  const lo = axis === 'x' ? box.y : box.x;
  const hi = axis === 'x' ? bottom(box) : right(box);
  return lo < band[1] && hi > band[0];
}

export function pointInBand(point: { x: number; y: number }, band: [number, number] | undefined, axis: Axis): boolean {
  if (!band) return true;
  const center = axis === 'x' ? point.y : point.x;
  return center >= band[0] - 1 && center <= band[1] + 1;
}

export function resize(box: Box, axis: Axis, delta: number): void {
  if (axis === 'x') {
    box.width = Math.max(1, box.width + delta);
  } else {
    box.height = Math.max(1, box.height + delta);
  }
}

export function beyondBand(box: Box, band: [number, number] | undefined, axis: Axis): boolean {
  if (!band) return false;
  const lo = axis === 'x' ? box.y : box.x;
  const hi = axis === 'x' ? bottom(box) : right(box);
  return lo < band[0] - 1 || hi > band[1] + 1;
}
