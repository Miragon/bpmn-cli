import { describe, expect, it } from 'vitest';
import { RouteCosts } from '../../../../src/drawing/incremental/routing/RouteCosts.js';

describe('RouteCosts', () => {
  it('turns each side outward along its direction', () => {
    const { DX, DY, OUTWARD } = RouteCosts;

    expect([DX[OUTWARD.right], DY[OUTWARD.bottom], DX[OUTWARD.left], DY[OUTWARD.top]]).toEqual([1, 1, -1, -1]);
  });

  it('prices a cut shape above any route of crossings and bends', () => {
    expect(RouteCosts.HIT).toBeGreaterThan(1000 * (RouteCosts.CROSS + RouteCosts.BEND));
  });
});
