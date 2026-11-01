import { describe, expect, it } from 'vitest';
import { LabelSpots } from '../../../../src/drawing/full/pools/LabelSpots.js';
import { Box, Point } from '../../../support/ModelValues.js';

describe('LabelSpots', () => {
  const label = new Box(0, 0, 40, 14);

  it('offers spots below and above a shape first, then beside it, then further out', () => {
    const { spots, near } = new LabelSpots(label).aroundShape(new Box(100, 100, 36, 36));

    expect(spots[0]!.y).toBe(142);
    expect(spots[1]!.bottom).toBe(94);
    expect(spots.slice(10, near).some((spot) => spot.x > 136)).toBe(true);
    expect(spots.length).toBeGreaterThan(near);
  });

  it('offers spots along level and vertical legs long enough for it', () => {
    const spots = new LabelSpots(label).alongLine([new Point(0, 100), new Point(200, 100), new Point(200, 300), new Point(201, 301)]);

    expect(spots.some((spot) => spot.bottom === 96)).toBe(true);
    expect(spots.some((spot) => spot.x === 206)).toBe(true);
  });
});
