import { Point, type Box } from '../../model/index.js';
import type { ShapeKind } from './DShape.js';

export type Side = 'left' | 'right' | 'top' | 'bottom';

export class ShapeSides {
  static readonly SOURCE_DEFAULT: readonly Side[] = ['right', 'bottom', 'top', 'left'];
  static readonly TARGET_DEFAULT: readonly Side[] = ['left', 'bottom', 'top', 'right'];

  private static readonly SOURCE_SIDES: Readonly<Partial<Record<ShapeKind, readonly Side[]>>> = {
    task: ['right', 'bottom', 'top'],
    subProcess: ['right', 'bottom', 'top'],
    gateway: ['right', 'bottom', 'top'],
    boundary: ['bottom'],
    participant: ['bottom', 'top'],
    lane: ['bottom', 'top'],
  };

  private static readonly TARGET_SIDES: Readonly<Partial<Record<ShapeKind, readonly Side[]>>> = {
    task: ['left', 'bottom', 'top'],
    subProcess: ['left', 'bottom', 'top'],
    gateway: ['left', 'bottom', 'top'],
    participant: ['top', 'bottom'],
    lane: ['top', 'bottom'],
  };

  static of(kind: ShapeKind, role: 'source' | 'target'): Side[] {
    return role === 'source' ? [...(ShapeSides.SOURCE_SIDES[kind] ?? ShapeSides.SOURCE_DEFAULT)] : [...(ShapeSides.TARGET_SIDES[kind] ?? ShapeSides.TARGET_DEFAULT)];
  }

  static attached(event: Box, host: Box): Side {
    const { x, y } = event.center;
    const distances: Array<[Side, number]> = [
      ['bottom', Math.abs(y - host.bottom)],
      ['right', Math.abs(x - host.right)],
      ['top', Math.abs(y - host.y)],
      ['left', Math.abs(x - host.x)],
    ];
    return distances.reduce((best, candidate) => (candidate[1] < best[1] ? candidate : best))[0];
  }

  static ofGateway(box: Box, point: Point): Side {
    const center = box.center;
    const dx = (point.x - center.x) / Math.max(1, box.width / 2);
    const dy = (point.y - center.y) / Math.max(1, box.height / 2);
    if (Math.abs(dx) >= Math.abs(dy)) {
      return dx > 0 ? 'right' : 'left';
    }
    return dy > 0 ? 'bottom' : 'top';
  }

  static span(box: Box, side: Side): [number, number] {
    return side === 'left' || side === 'right' ? [box.y, box.bottom] : [box.x, box.right];
  }

  static pointOn(box: Box, side: Side, progress: number): Point {
    switch (side) {
      case 'left':
        return new Point(box.x, progress);
      case 'right':
        return new Point(box.right, progress);
      case 'top':
        return new Point(progress, box.y);
      case 'bottom':
        return new Point(progress, box.bottom);
    }
  }
}
