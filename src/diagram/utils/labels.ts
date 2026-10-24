/**
 * Where an external label sits relative to its shape or flow, as plain
 * geometry (src/diagram/LabelPlacer.ts finds free spots with it).
 *
 * CONTRACT
 *  - labelAt(shape, size, side, host?) is the label box on one side of a
 *    shape: below/above centred, left/right vertically centred; a boundary
 *    event's 'below' sits below the host border, right of the event.
 *  - labelArea(frame) is where the label of a shape in that frame goes
 *    first: the frame 2 px inside its border, below its title.
 *  - labelSideOf(shape) says on which side of its shape a label sits
 *    ('inside' when it overlaps the shape), edgeLabelSideOf(edge) the side of
 *    the nearest segment; defaultLabelSide(kind) is the convention (events /
 *    data below, gateways above).
 *  - edgeLabelAt(edge, size, side) is the label box of a flow on one side:
 *    above / below the longest horizontal segment, left / right of the
 *    longest vertical one (undefined when the flow has none).
 */
import type { DEdge, DShape } from '../types.js';
import { bottom, cx, cy, right, type Box } from './geom.js';
import { titleOf } from './plane.js';

export type LabelSide = 'above' | 'below' | 'left' | 'right';

/** Shapes drawn with an external label (bpmn-js): events, gateways, data. */
export function hasExternalLabel(s: Pick<DShape, 'kind'>): boolean {
  return s.kind === 'event' || s.kind === 'boundary' || s.kind === 'gateway' || s.kind === 'data';
}

/** The label box on one side of a shape. */
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

/**
 * Where a label of a shape inside `frame` goes first: the frame 2 px inside
 * its border, below the title of an expanded sub-process.
 */
export function labelArea(frame: DShape): Box {
  const b = frame.bounds;
  const title = titleOf(frame);
  const top = title ? bottom(title) + 2 : b.y + 2;
  return { x: b.x + 2, y: top, width: Math.max(0, b.width - 4), height: Math.max(0, bottom(b) - 2 - top) };
}

export const ORDER: Record<string, LabelSide[]> = {
  event: ['below', 'above', 'right', 'left'],
  boundary: ['below', 'right', 'left', 'above'],
  gateway: ['above', 'below', 'right', 'left'],
  data: ['below', 'right', 'left', 'above'],
};

/** The convention for a shape kind's external label (the first side placeShapeLabel tries). */
export function defaultLabelSide(kind: DShape['kind']): LabelSide {
  return ORDER[kind]?.[0] ?? 'below';
}

/** Side of its shape a label sits on (see module contract). */
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

/** Side of the nearest segment a flow label sits on. */
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

/** The label box of a flow on one side (see module contract). */
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
