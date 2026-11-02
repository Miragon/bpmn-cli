import { describe, expect, it } from 'vitest';
import { Samples } from '../../../src/model/geometry/Samples.js';

describe('Samples', () => {
  it('finds the median of an odd and an even count of shape widths', () => {
    expect(new Samples([100, 36, 50]).median()).toBe(50);
    expect(new Samples([100, 36, 50, 60]).median()).toBe(55);
  });

  it('has no median without samples', () => {
    expect(new Samples([]).median()).toBeUndefined();
  });
});
