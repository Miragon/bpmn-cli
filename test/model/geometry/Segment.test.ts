import { describe, expect, it } from 'vitest';
import { Box } from '../../../src/model/geometry/Box.js';
import { Point } from '../../../src/model/geometry/Point.js';
import { Segment } from '../../../src/model/geometry/Segment.js';

describe('Segment', () => {
  const task = new Box(100, 100, 100, 80);
  const across = new Segment(new Point(50, 140), new Point(250, 140));

  it('reads as its two ends', () => {
    const [start, end] = across;

    expect([start, end]).toEqual([across.start, across.end]);
  });

  it('hits a shape it runs through, not one it only touches', () => {
    expect(across.hits(task)).toBe(true);
    expect(new Segment(new Point(50, 100), new Point(250, 100)).hits(task)).toBe(false);
  });

  it('clips a diagonal line, so a straight association beside a shape does not hit it', () => {
    const beside = new Segment(new Point(90, 170), new Point(103, 195));

    expect(beside.hitsBounds(task)).toBe(true);
    expect(beside.hits(task)).toBe(false);
    expect(new Segment(new Point(90, 90), new Point(210, 190)).hits(task)).toBe(true);
  });

  it('never hits a shape smaller than the shrink on both sides', () => {
    const tiny = new Box(100, 100, 3, 3);

    expect(new Segment(new Point(90, 90), new Point(110, 111)).hits(tiny)).toBe(false);
  });

  it('crosses another line properly', () => {
    expect(across.crosses(new Segment(new Point(150, 50), new Point(150, 250)))).toBe(true);
  });

  it('takes a shared end point, a T-junction and a collinear run for no crossing', () => {
    expect(across.crosses(new Segment(new Point(50, 140), new Point(50, 250)))).toBe(false);
    expect(across.crosses(new Segment(new Point(150, 140), new Point(150, 250)))).toBe(false);
    expect(across.crosses(new Segment(new Point(60, 140), new Point(240, 140)))).toBe(false);
  });
});
