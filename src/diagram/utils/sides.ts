/**
 * The BPMN conventions for the sides a connection leaves and enters a shape by.
 */
import type { Box, Point, ShapeKind, Side } from '../types.js';
import { bottom, cx, cy, right } from './geom.js';

export const SOURCE_DEFAULT: Side[] = ['right', 'bottom', 'top', 'left'];

export const TARGET_DEFAULT: Side[] = ['left', 'bottom', 'top', 'right'];

/** BPMN conventions for the sides a connection may leave (`source`) or enter (`target`) a shape. */
export function defaultSides(kind: ShapeKind, role: 'source' | 'target'): Side[] {
  const source = role === 'source';
  switch (kind) {
    case 'task':
    case 'subProcess':
    case 'gateway':
      return source ? ['right', 'bottom', 'top'] : ['left', 'bottom', 'top'];
    case 'boundary':
      return source ? ['bottom'] : [...TARGET_DEFAULT];
    case 'participant':
    case 'lane':
      return source ? ['bottom', 'top'] : ['top', 'bottom'];
    default:
      return source ? [...SOURCE_DEFAULT] : [...TARGET_DEFAULT];
  }
}

/** the border of `host` a boundary event sits on (the side its flows should leave by) */
export function attachedSide(event: Box, host: Box): Side {
  const cx = event.x + event.width / 2;
  const cy = event.y + event.height / 2;
  const dist: Array<[Side, number]> = [
    ['bottom', Math.abs(cy - bottom(host))],
    ['right', Math.abs(cx - right(host))],
    ['top', Math.abs(cy - host.y)],
    ['left', Math.abs(cx - host.x)],
  ];
  return dist.reduce((a, b) => (b[1] < a[1] ? b : a))[0];
}

/**
 * The side of a gateway a docking point lies on: the vertex it is nearest to
 * (by the diamond's own proportions).
 */
export function gatewaySide(b: Box, p: Point): Side {
  const dx = (p.x - cx(b)) / Math.max(1, b.width / 2);
  const dy = (p.y - cy(b)) / Math.max(1, b.height / 2);
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'bottom' : 'top';
}
