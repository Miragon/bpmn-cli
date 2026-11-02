import { describe, expect, it } from 'vitest';
import { RunHeights } from '../../../../src/drawing/full/routing/RunHeights.js';
import { Box } from '../../../support/ModelValues.js';

describe('RunHeights', () => {
  it('runs 15 px below where it starts when nothing is near', () => {
    expect(new RunHeights(0, 100, []).below(50)).toBe(65);
  });

  it('keeps clear of each box in reach, whatever their order', () => {
    const boxes = [new Box(10, 60, 20, 20), new Box(40, 90, 20, 20)];

    expect(new RunHeights(0, 100, boxes).below(50)).toBe(125);
    expect(new RunHeights(100, 0, [...boxes].reverse()).below(50)).toBe(125);
  });

  it('ignores a box beside the span of the run', () => {
    expect(new RunHeights(0, 100, [new Box(200, 60, 20, 20)]).below(50)).toBe(65);
  });

  it('runs above a box over the start', () => {
    expect(new RunHeights(0, 100, [new Box(10, 20, 20, 20)]).above(50)).toBe(5);
  });
});
