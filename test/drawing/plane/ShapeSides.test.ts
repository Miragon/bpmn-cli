import { describe, expect, it } from 'vitest';
import { ShapeSides } from '../../../src/drawing/plane/ShapeSides.js';
import { Box, Point } from '../../support/ModelValues.js';

describe('ShapeSides', () => {
  it('leaves activities right, bottom, top, and enters them left, bottom, top', () => {
    expect(ShapeSides.of('task', 'source')).toEqual(['right', 'bottom', 'top']);
    expect(ShapeSides.of('gateway', 'target')).toEqual(['left', 'bottom', 'top']);
  });

  it('leaves a boundary event by the bottom and takes other shapes on all sides', () => {
    expect(ShapeSides.of('boundary', 'source')).toEqual(['bottom']);
    expect(ShapeSides.of('event', 'source')).toEqual(['right', 'bottom', 'top', 'left']);
    expect(ShapeSides.of('boundary', 'target')).toEqual(['left', 'bottom', 'top', 'right']);
    expect(ShapeSides.of('lane', 'target')).toEqual(['top', 'bottom']);
  });

  it('finds the border a boundary event sits on', () => {
    const host = new Box(0, 0, 100, 80);

    expect(ShapeSides.attached(new Box(30, 62, 36, 36), host)).toBe('bottom');
    expect(ShapeSides.attached(new Box(30, -18, 36, 36), host)).toBe('top');
    expect(ShapeSides.attached(new Box(82, 20, 36, 36), host)).toBe('right');
  });

  it('finds the nearest vertex of a gateway', () => {
    const gateway = new Box(0, 0, 50, 50);

    expect(ShapeSides.ofGateway(gateway, new Point(50, 25))).toBe('right');
    expect(ShapeSides.ofGateway(gateway, new Point(0, 26))).toBe('left');
    expect(ShapeSides.ofGateway(gateway, new Point(25, 50))).toBe('bottom');
    expect(ShapeSides.ofGateway(gateway, new Point(26, 0))).toBe('top');
  });

  it('measures a side and puts a point on it', () => {
    const box = new Box(10, 20, 100, 80);

    expect(ShapeSides.span(box, 'left')).toEqual([20, 100]);
    expect(ShapeSides.span(box, 'top')).toEqual([10, 110]);
    expect(ShapeSides.pointOn(box, 'left', 50)).toMatchObject({ x: 10, y: 50 });
    expect(ShapeSides.pointOn(box, 'right', 50)).toMatchObject({ x: 110, y: 50 });
    expect(ShapeSides.pointOn(box, 'top', 50)).toMatchObject({ x: 50, y: 20 });
    expect(ShapeSides.pointOn(box, 'bottom', 50)).toMatchObject({ x: 50, y: 100 });
  });
});
