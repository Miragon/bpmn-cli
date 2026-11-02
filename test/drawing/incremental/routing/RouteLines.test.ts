import { describe, expect, it } from 'vitest';
import type { Port } from '../../../../src/drawing/incremental/routing/RoutePorts.js';
import { RouteLines } from '../../../../src/drawing/incremental/routing/RouteLines.js';
import { Point } from '../../../support/ModelValues.js';

describe('RouteLines', () => {
  const topPort: Port = { x: 300, y: 100, side: 'top', cost: 0 };
  const bottomPort: Port = { x: 300, y: 200, side: 'bottom', cost: 0 };

  it('names each run and keeps the ends of a line', () => {
    const line = [new Point(0, 0), new Point(100, 0), new Point(100, 50), new Point(150, 80)];
    const segs = new RouteLines().segments([line]);

    expect(segs.map(({ kind }) => kind)).toEqual(['h', 'v', 'd']);
    expect(segs[0]?.ends).toEqual([line[0]]);
    expect(segs[2]?.ends).toBeUndefined();
  });

  it('drops an empty run and one without coordinates', () => {
    const segs = new RouteLines().segments([[new Point(0, 0), new Point(0, 0), new Point(Number.NaN, 0), new Point(5, 5), new Point(5, 9)]]);

    expect(segs.map(({ kind }) => kind)).toEqual(['v']);
  });

  it('marks a line that may be crossed for free', () => {
    const free = [new Point(0, 0), new Point(100, 0)];
    const [seg] = new RouteLines([], 0, new Set([free])).segments([free]);

    expect(seg?.free).toBe(true);
  });

  it('marks the last run into a join from above and not one that enters from the far side', () => {
    const fromAbove = [new Point(100, 20), new Point(300, 20), new Point(300, 100)];
    const fromBelow = [new Point(100, 180), new Point(300, 180), new Point(300, 100)];
    const segs = new RouteLines([topPort]).segments([fromAbove, fromBelow]);

    expect(segs.map((seg) => seg.merge === true)).toEqual([false, true, false, false]);
  });

  it('marks the run into a join from below', () => {
    const segs = new RouteLines([bottomPort]).segments([[new Point(300, 300), new Point(300, 200)]]);

    expect(segs[0]?.merge).toBe(true);
  });

  it('marks a short hook before the join and the run before it', () => {
    const line = [new Point(0, 50), new Point(280, 50), new Point(280, 20), new Point(300, 20), new Point(300, 100)];
    const segs = new RouteLines([topPort], 40).segments([line]);

    expect(segs.map((seg) => seg.merge === true)).toEqual([false, true, true, true]);
  });

  it('joins two consecutive vertical pieces into one run', () => {
    const line = [new Point(300, 0), new Point(300, 50), new Point(300, 100)];

    expect(new RouteLines([topPort]).segments([line]).every((seg) => seg.merge)).toBe(true);
  });

  it('marks the runs two lines into one join share', () => {
    const first = [new Point(0, 20), new Point(300, 20), new Point(300, 100)];
    const second = [new Point(100, 20), new Point(300, 20), new Point(300, 100)];
    const segs = new RouteLines([topPort], 10).segments([first, second]);

    expect(segs.every((seg) => seg.merge)).toBe(true);
  });

  it('stops sharing where two lines into one join part', () => {
    const first = [new Point(0, 20), new Point(300, 20), new Point(300, 100)];
    const second = [new Point(0, 60), new Point(300, 60), new Point(300, 100)];
    const segs = new RouteLines([topPort], 10).segments([first, second]);

    expect(segs.map((seg) => seg.merge === true)).toEqual([false, true, false, true]);
  });

  it('counts two parallel runs on one track as an overlap and a gap as none', () => {
    const run = [new Point(0, 0), new Point(100, 0)] as const;

    expect(RouteLines.overlap(...run, new Point(50, 1), new Point(200, 1))).toBe(true);
    expect(RouteLines.overlap(...run, new Point(50, 5), new Point(200, 5))).toBe(false);
    expect(RouteLines.overlap(new Point(0, 0), new Point(0, 100), new Point(1, 50), new Point(1, 200))).toBe(true);
    expect(RouteLines.overlap(new Point(0, 0), new Point(0, 100), new Point(9, 50), new Point(9, 200))).toBe(false);
    expect(RouteLines.overlap(...run, new Point(0, 0), new Point(0, 100))).toBe(false);
  });
});
