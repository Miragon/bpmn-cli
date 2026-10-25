/** Where an external label sits relative to its shape or flow, as plain geometry. */
import type { DEdge, DShape } from '../types.js';
import { bottom, cx, cy, right, type Box } from './geom.js';

export type LabelSide = 'above' | 'below' | 'left' | 'right';

/** bpmn-js draws events, gateways and data with an external label. */
export function hasExternalLabel(s: Pick<DShape, 'kind'>): boolean {
  return s.kind === 'event' || s.kind === 'boundary' || s.kind === 'gateway' || s.kind === 'data';
}

/** A boundary event's 'below' sits below the host border, right of the event. */
export function labelAt(s: DShape, size: { width: number; height: number }, side: LabelSide, host?: DShape, step = 0): Box {
  const b = s.bounds;
  const off = 6 + step * (size.height + 4);
  if (side === 'below' && s.kind === 'boundary' && host) {
    return { x: Math.round(right(b) + 4), y: Math.round(bottom(host.bounds) + 2 + step * (size.height + 4)), ...size };
  }
  switch (side) {
    case 'below':
      return { x: Math.round(cx(b) - size.width / 2), y: Math.round(bottom(b) + off), ...size };
    case 'above':
      return { x: Math.round(cx(b) - size.width / 2), y: Math.round(b.y - size.height - off), ...size };
    case 'right':
      return { x: Math.round(right(b) + 6 + step * 10), y: Math.round(cy(b) - size.height / 2), ...size };
    case 'left':
      return { x: Math.round(b.x - size.width - 6 - step * 10), y: Math.round(cy(b) - size.height / 2), ...size };
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

/** 'inside' when the label overlaps the shape. */
export function labelSideOf(s: Pick<DShape, 'bounds' | 'label' | 'kind' | 'hostId'>, host?: Box): LabelSide | 'inside' | undefined {
  const l = s.label;
  if (!l) return undefined;
  const b = s.bounds;
  // a boundary event's label hangs below its host border
  if (host && s.kind === 'boundary' && l.y >= bottom(host) - 2) return 'below';
  if (l.y >= bottom(b) - 2) return 'below';
  if (bottom(l) <= b.y + 2) return 'above';
  if (l.x >= right(b) - 2) return 'right';
  if (right(l) <= b.x + 2) return 'left';
  return 'inside';
}

export function edgeLabelSideOf(e: Pick<DEdge, 'points' | 'label'>): LabelSide | undefined {
  const l = e.label;
  if (!l || e.points.length < 2) return undefined;
  const c = { x: cx(l), y: cy(l) };
  let best: LabelSide | undefined;
  let bestD = Infinity;
  for (let i = 0; i + 1 < e.points.length; i++) {
    const p = e.points[i]!;
    const q = e.points[i + 1]!;
    const horizontal = Math.abs(p.y - q.y) <= Math.abs(p.x - q.x);
    const lo = horizontal ? Math.min(p.x, q.x) : Math.min(p.y, q.y);
    const hi = horizontal ? Math.max(p.x, q.x) : Math.max(p.y, q.y);
    const along = horizontal ? c.x : c.y;
    const off = Math.max(0, lo - along, along - hi);
    const across = horizontal ? c.y - p.y : c.x - p.x;
    const d = Math.hypot(off, across);
    if (d < bestD) {
      bestD = d;
      best = horizontal ? (across < 0 ? 'above' : 'below') : across < 0 ? 'left' : 'right';
    }
  }
  return best;
}

/** Beside the longest horizontal or vertical segment; undefined when there is none. */
export function edgeLabelAt(e: Pick<DEdge, 'points'>, size: { width: number; height: number }, side: LabelSide): Box | undefined {
  const horizontal = side === 'above' || side === 'below';
  let best: [{ x: number; y: number }, { x: number; y: number }] | undefined;
  let len = 0;
  for (let i = 0; i + 1 < e.points.length; i++) {
    const p = e.points[i]!;
    const q = e.points[i + 1]!;
    const l = horizontal ? (Math.abs(p.y - q.y) < 0.5 ? Math.abs(p.x - q.x) : 0) : Math.abs(p.x - q.x) < 0.5 ? Math.abs(p.y - q.y) : 0;
    if (l > len) {
      len = l;
      best = [p, q];
    }
  }
  if (!best) return undefined;
  const [p, q] = best;
  if (horizontal) {
    const x = Math.round((p.x + q.x) / 2 - size.width / 2);
    return { x, y: Math.round(side === 'above' ? p.y - size.height - 4 : p.y + 4), ...size };
  }
  const y = Math.round((p.y + q.y) / 2 - size.height / 2);
  return { x: Math.round(side === 'left' ? p.x - size.width - 6 : p.x + 6), y, ...size };
}
