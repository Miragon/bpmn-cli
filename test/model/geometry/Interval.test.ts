import { describe, expect, it } from 'vitest';
import { Interval } from '../../../src/model/geometry/Interval.js';

describe('Interval', () => {
  it('keeps a coordinate between its borders', () => {
    const lane = new Interval(10, 20);

    expect([lane.clamp(5), lane.clamp(15), lane.clamp(25)]).toEqual([10, 15, 20]);
  });
});
