/** The BPMN conventions for the sides a connection leaves and enters a shape by. */
import type { Box, Point, ShapeKind, Side } from '../types.js';
import { bottom, cx, cy, right } from './geom.js';

export const SOURCE_DEFAULT: Side[] = ['right', 'bottom', 'top', 'left'];

export const TARGET_DEFAULT: Side[] = ['left', 'bottom', 'top', 'right'];

/** Activities and gateways exit right/bottom/top and enter left/bottom/top. */
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

/** The border a boundary event sits on is the side its flows should leave by. */
export function attachedSide(event: Box, host: Box): Side {
  const cx = event.x + event.width / 2;
  const cy = event.y + event.height / 2;
  const dist: Array<[Side, number]> = [
    ['bottom', Math.abs(cy - bottom(host))],
    ['right', Math.abs(cx - right(host))],
    ['top', Math.abs(cy - host.y)],
    ['left', Math.abs(cx - host.x)],
  ];
  return dist.reduce((best, candidate) => (candidate[1] < best[1] ? candidate : best))[0];
}

/** The nearest vertex, by the diamond's own proportions. */
export function gatewaySide(box: Box, point: Point): Side {
  const dx = (point.x - cx(box)) / Math.max(1, box.width / 2);
  const dy = (point.y - cy(box)) / Math.max(1, box.height / 2);
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'bottom' : 'top';
}
