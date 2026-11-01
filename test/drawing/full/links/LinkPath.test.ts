import { describe, expect, it } from 'vitest';
import { LinkPath } from '../../../../src/drawing/full/links/LinkPath.js';
import { Box, Point, Polyline } from '../../../support/ModelValues.js';

describe('LinkPath', () => {
  const path = (...coordinates: Array<[number, number]>): LinkPath => new LinkPath(coordinates.map(([x, y]) => new Point(x, y)));
  const line = (...coordinates: Array<[number, number]>) => new Polyline(coordinates.map(([x, y]) => new Point(x, y))).segments();

  it('measures its length along the legs and knows a slanted leg', () => {
    expect(path([0, 0], [10, 0], [10, 5]).length()).toBe(15);
    expect(path([0, 0], [10, 5]).isDiagonal()).toBe(true);
    expect(path([0, 0], [10, 0]).isDiagonal()).toBe(false);
  });

  it('reads a run lying on or just beside a line as running along it', () => {
    expect(path([0, 0], [100, 0]).runsAlongLines(line([50, 3], [150, 3]))).toBe(true);
    expect(path([0, 0], [0, 100]).runsAlongLines(line([2, 50], [2, 150]))).toBe(true);
    expect(path([0, 0], [100, 0]).runsAlongLines(line([50, 30], [150, 30]))).toBe(false);
    expect(path([0, 0], [100, 0]).runsAlongLines(line([0, 0], [100, 0]), 1)).toBe(false);
  });

  it('counts a leg along a shape or a lane border, but not the leg leaving its own end', () => {
    const box = new Box(50, 10, 100, 100);
    const other = new Box(0, 500, 10, 10);

    expect(path([0, 12], [100, 12]).hugsBorders([box], other, other, [])).toBe(true);
    expect(path([52, 0], [52, 50]).hugsBorders([box], other, other, [])).toBe(true);
    expect(path([52, 0], [52, 50]).hugsBorders([box], box, other, [])).toBe(false);
    expect(path([0, 200], [40, 200]).hugsBorders([], other, other, [202])).toBe(true);
    expect(path([0, 200], [40, 200]).hugsBorders([box], other, other, [])).toBe(false);
  });
});
