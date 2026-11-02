import { describe, expect, it } from 'vitest';
import { Point } from '../../../src/model/geometry/Point.js';

describe('Point', () => {
  it('moves a waypoint in place', () => {
    const waypoint = new Point(10, 20);

    waypoint.translate(5, -5);

    expect(waypoint).toEqual(new Point(15, 15));
  });

  it('copies a waypoint so the copy moves alone', () => {
    const waypoint = new Point(1, 2);
    const copy = waypoint.copy();

    copy.translate(1, 1);

    expect(waypoint).toEqual(new Point(1, 2));
  });
});
