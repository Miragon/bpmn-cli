/** Where an external label sits relative to its shape or flow, as plain geometry. */
import type { DEdge, DShape } from '../di/types.js';
import { bottom, cx, cy, right, type Box } from './geom.js';

export type LabelSide = 'above' | 'below' | 'left' | 'right';

/** bpmn-js draws events, gateways and data with an external label. */
export function hasExternalLabel(shape: Pick<DShape, 'kind'>): boolean {
  return shape.kind === 'event' || shape.kind === 'boundary' || shape.kind === 'gateway' || shape.kind === 'data';
}

/** A boundary event's 'below' sits below the host border, right of the event. */
export function labelAt(shape: DShape, size: { width: number; height: number }, side: LabelSide, host?: DShape, step = 0): Box {
  const bounds = shape.bounds;
  const off = 6 + step * (size.height + 4);
  if (side === 'below' && shape.kind === 'boundary' && host) {
    return { x: Math.round(right(bounds) + 4), y: Math.round(bottom(host.bounds) + 2 + step * (size.height + 4)), ...size };
  }
  switch (side) {
    case 'below':
      return { x: Math.round(cx(bounds) - size.width / 2), y: Math.round(bottom(bounds) + off), ...size };
    case 'above':
      return { x: Math.round(cx(bounds) - size.width / 2), y: Math.round(bounds.y - size.height - off), ...size };
    case 'right':
      return { x: Math.round(right(bounds) + 6 + step * 10), y: Math.round(cy(bounds) - size.height / 2), ...size };
    case 'left':
      return { x: Math.round(bounds.x - size.width - 6 - step * 10), y: Math.round(cy(bounds) - size.height / 2), ...size };
  }
}

export const ORDER: Record<string, LabelSide[]> = {
  event: ['below', 'above', 'right', 'left'],
  boundary: ['below', 'right', 'left', 'above'],
  gateway: ['above', 'below', 'right', 'left'],
  data: ['below', 'right', 'left', 'above'],
};

/** Events and data below, gateways above. */
export function defaultLabelSide(kind: DShape['kind']): LabelSide {
  return ORDER[kind]?.[0] ?? 'below';
}

/**
 * 'inside' when the label overlaps the shape.
 * A boundary event's label below its host's border is 'below'.
 */
export function labelSideOf(shape: Pick<DShape, 'bounds' | 'label' | 'kind' | 'hostId'>, host?: Box): LabelSide | 'inside' | undefined {
  const label = shape.label;
  if (!label) return undefined;
  const bounds = shape.bounds;
  if (host && shape.kind === 'boundary' && label.y >= bottom(host) - 2) return 'below';
  if (label.y >= bottom(bounds) - 2) return 'below';
  if (bottom(label) <= bounds.y + 2) return 'above';
  if (label.x >= right(bounds) - 2) return 'right';
  if (right(label) <= bounds.x + 2) return 'left';
  return 'inside';
}

export function edgeLabelSideOf(edge: Pick<DEdge, 'points' | 'label'>): LabelSide | undefined {
  const label = edge.label;
  if (!label || edge.points.length < 2) return undefined;
  const middle = { x: cx(label), y: cy(label) };
  let best: LabelSide | undefined;
  let bestD = Infinity;
  for (let index = 0; index + 1 < edge.points.length; index++) {
    const start = edge.points[index]!;
    const end = edge.points[index + 1]!;
    const horizontal = Math.abs(start.y - end.y) <= Math.abs(start.x - end.x);
    const lo = horizontal ? Math.min(start.x, end.x) : Math.min(start.y, end.y);
    const hi = horizontal ? Math.max(start.x, end.x) : Math.max(start.y, end.y);
    const along = horizontal ? middle.x : middle.y;
    const off = Math.max(0, lo - along, along - hi);
    const across = horizontal ? middle.y - start.y : middle.x - start.x;
    const distance = Math.hypot(off, across);
    if (distance < bestD) {
      bestD = distance;
      best = horizontal ? (across < 0 ? 'above' : 'below') : across < 0 ? 'left' : 'right';
    }
  }
  return best;
}

/** Beside the longest horizontal or vertical segment; undefined when there is none. */
export function edgeLabelAt(edge: Pick<DEdge, 'points'>, size: { width: number; height: number }, side: LabelSide): Box | undefined {
  const horizontal = side === 'above' || side === 'below';
  let best: [{ x: number; y: number }, { x: number; y: number }] | undefined;
  let len = 0;
  for (let index = 0; index + 1 < edge.points.length; index++) {
    const start = edge.points[index]!;
    const end = edge.points[index + 1]!;
    const length = horizontal ? (Math.abs(start.y - end.y) < 0.5 ? Math.abs(start.x - end.x) : 0) : Math.abs(start.x - end.x) < 0.5 ? Math.abs(start.y - end.y) : 0;
    if (length > len) {
      len = length;
      best = [start, end];
    }
  }
  if (!best) return undefined;
  const [bestStart, bestEnd] = best;
  if (horizontal) {
    const left = Math.round((bestStart.x + bestEnd.x) / 2 - size.width / 2);
    return { x: left, y: Math.round(side === 'above' ? bestStart.y - size.height - 4 : bestStart.y + 4), ...size };
  }
  const top = Math.round((bestStart.y + bestEnd.y) / 2 - size.height / 2);
  return { x: Math.round(side === 'left' ? bestStart.x - size.width - 6 : bestStart.x + 6), y: top, ...size };
}
