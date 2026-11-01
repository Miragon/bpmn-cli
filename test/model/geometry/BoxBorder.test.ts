import { describe, expect, it } from 'vitest';
import { Box } from '../../../src/model/geometry/Box.js';
import { BoxBorder } from '../../../src/model/geometry/BoxBorder.js';
import { Point } from '../../../src/model/geometry/Point.js';

describe('BoxBorder', () => {
  const border = new BoxBorder(new Box(0, 0, 100, 80));

  it('measures the way to the border from outside and from inside', () => {
    expect(border.distanceTo(new Point(103, 84))).toBe(5);
    expect(border.distanceTo(new Point(10, 40))).toBe(10);
  });

  it('finds where a line towards a point leaves the shape', () => {
    expect(border.pointTowards(new Point(200, 40))).toEqual(new Point(100, 40));
    expect(border.pointTowards(new Point(50, -100))).toEqual(new Point(50, 0));
  });

  it('stays at the centre when the target is the centre', () => {
    expect(border.pointTowards(new Point(50, 40))).toEqual(new Point(50, 40));
  });
});
