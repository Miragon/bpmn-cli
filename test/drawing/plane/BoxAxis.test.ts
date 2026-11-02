import { describe, expect, it } from 'vitest';
import { BoxAxis } from '../../../src/drawing/plane/BoxAxis.js';
import { Box, Point } from '../../support/ModelValues.js';

describe('BoxAxis', () => {
  const [x, y] = [BoxAxis.of('x'), BoxAxis.of('y')];

  it('reads the near and far edge of a box along its axis', () => {
    const box = new Box(10, 20, 100, 80);

    expect([x.near(box), x.far(box), y.near(box), y.far(box)]).toEqual([10, 110, 20, 100]);
  });

  it('shifts and resizes along its axis, never below 1 px', () => {
    const box = new Box(10, 20, 100, 80);

    x.shift(box, 5);
    y.shift(box, -5);
    x.resize(box, -500);
    y.resize(box, 20);

    expect([box.x, box.y, box.width, box.height]).toEqual([15, 15, 1, 100]);
  });

  it('takes the band across the axis, none without a frame', () => {
    const frame = new Box(10, 20, 100, 80);

    expect(x.bandOf(frame)).toEqual([20, 100]);
    expect(y.bandOf(frame)).toEqual([10, 110]);
    expect(x.bandOf(undefined)).toBeUndefined();
  });

  it('tells where a box and a point lie to a band', () => {
    const box = new Box(0, 90, 10, 20);

    expect(x.centreInBand(box, [0, 95])).toBe(false);
    expect(x.centreInBand(box, undefined)).toBe(true);
    expect(y.centreInBand(box, [0, 10])).toBe(true);
    expect(x.overlapsBand(box, [100, 200])).toBe(true);
    expect(x.overlapsBand(box, [200, 300])).toBe(false);
    expect(x.pointInBand(new Point(0, 101), [0, 100])).toBe(true);
    expect(x.pointInBand(new Point(0, 102), [0, 100])).toBe(false);
    expect(y.pointInBand(new Point(0, 0), undefined)).toBe(true);
    expect(x.beyondBand(box, [90, 110])).toBe(false);
    expect(x.beyondBand(box, [0, 100])).toBe(true);
    expect(x.beyondBand(box, undefined)).toBe(false);
  });
});
