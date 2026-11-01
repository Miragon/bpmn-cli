import { describe, expect, it } from 'vitest';
import { RouteGrid } from '../../../../src/drawing/incremental/grid/RouteGrid.js';
import { RouteSearch } from '../../../../src/drawing/incremental/grid/RouteSearch.js';
import type { Port } from '../../../../src/drawing/incremental/routing/RoutePorts.js';
import { Point } from '../../../support/ModelValues.js';

describe('RouteSearch', () => {
  const lines = [0, 10, 20, 30];
  const leavingRight: Port = { x: 0, y: 10, side: 'right', cost: 0 };
  const enteringLeft: Port = { x: 30, y: 10, side: 'left', cost: 3 };

  function plainGrid(): RouteGrid {
    const grid = new RouteGrid(lines, lines);
    grid.hCost.fill(10);
    grid.vCost.fill(10);
    return grid;
  }

  it('runs straight along a free row and counts the port it enters', () => {
    const found = new RouteSearch(plainGrid()).find([leavingRight], [enteringLeft]);

    expect(found?.points).toEqual([new Point(0, 10), new Point(30, 10)]);
    expect(found?.cost).toBe(33);
  });

  it('turns once to reach a port from above', () => {
    const found = new RouteSearch(plainGrid()).find([leavingRight], [{ x: 20, y: 30, side: 'top', cost: 0 }]);

    expect(found?.points).toEqual([new Point(0, 10), new Point(20, 10), new Point(20, 30)]);
  });

  it('goes around a run that is priced out', () => {
    const grid = plainGrid();
    grid.hCost[1 * 3 + 1] = 1_000_000;

    expect(new RouteSearch(grid).find([leavingRight], [enteringLeft])?.points.length).toBeGreaterThan(2);
  });

  it('finds nothing on an empty grid or without a target on the grid', () => {
    expect(new RouteSearch(new RouteGrid([], [])).find([leavingRight], [enteringLeft])).toBeUndefined();
    expect(new RouteSearch(plainGrid()).find([leavingRight], [{ x: 5, y: 5, side: 'left', cost: 0 }])).toBeUndefined();
  });

  it('finds nothing when a source lies off the grid', () => {
    expect(new RouteSearch(plainGrid()).find([{ x: 5, y: 5, side: 'right', cost: 0 }], [enteringLeft])).toBeUndefined();
  });

  it('keeps the cheaper of two ports on one spot', () => {
    const found = new RouteSearch(plainGrid()).find([{ ...leavingRight, cost: 9 }, leavingRight], [enteringLeft, { ...enteringLeft, cost: 1 }]);

    expect(found?.cost).toBe(31);
  });

  it('pays for joining an existing line once and rides on it', () => {
    const grid = plainGrid();
    grid.hOv.fill(1);
    grid.anyOv = true;

    expect(new RouteSearch(grid).find([leavingRight], [enteringLeft])?.cost).toBe(333);
  });

  it('rides a shared tail for free and pays for leaving it', () => {
    const grid = plainGrid();
    grid.hMg[1 * 3 + 0] = 1;
    grid.anyMg = true;

    expect(new RouteSearch(grid).find([leavingRight], [enteringLeft])?.cost).toBe(333);
  });

  it('estimates every approach to a port from each side', () => {
    const ports: Port[] = [
      { x: 10, y: 0, side: 'bottom', cost: 0 },
      { x: 20, y: 30, side: 'top', cost: 0 },
      { x: 0, y: 20, side: 'right', cost: 0 },
    ];
    for (const target of ports) {
      expect(new RouteSearch(plainGrid()).find([{ x: 30, y: 20, side: 'left', cost: 0 }], [target])).toBeDefined();
    }
  });
});
