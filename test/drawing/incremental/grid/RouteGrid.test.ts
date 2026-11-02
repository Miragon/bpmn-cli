import { describe, expect, it } from 'vitest';
import { RouteGrid } from '../../../../src/drawing/incremental/grid/RouteGrid.js';
import { RouteCosts } from '../../../../src/drawing/incremental/routing/RouteCosts.js';
import { Box, Point } from '../../../support/ModelValues.js';

describe('RouteGrid', () => {
  const lines = [0, 10, 20, 30];

  it('charges the runs inside a box and only those', () => {
    const grid = new RouteGrid(lines, lines);
    grid.addInside(new Box(5, 5, 20, 20), 1000, 0);

    expect(grid.hCost[1 * 3 + 1]).toBe(1000);
    expect(grid.hCost[0]).toBe(0);
    expect(grid.vCost[1 * 4 + 1]).toBe(1000);
  });

  it('charges the runs along the outline of a box', () => {
    const grid = new RouteGrid(lines, lines);
    grid.addOutline(new Box(10, 10, 10, 10), 7);

    expect(grid.hCost[1 * 3 + 1]).toBe(7);
    expect(grid.hCost[2 * 3 + 1]).toBe(7);
    expect(grid.vCost[1 * 4 + 1]).toBe(7);
    expect(grid.vCost[1 * 4 + 2]).toBe(7);
    expect(grid.hCost[0]).toBe(0);
  });

  it('skips an outline that lies off every grid line', () => {
    const grid = new RouteGrid(lines, lines);
    grid.addOutline(new Box(13, 13, 4, 4), 7);

    expect([...grid.hCost, ...grid.vCost].every((cost) => cost === 0)).toBe(true);
  });

  it('flags a run along a horizontal line and charges a crossing of a vertical one', () => {
    const grid = new RouteGrid(lines, lines);
    grid.markLine({ start: new Point(0, 10), end: new Point(30, 10), kind: 'h' });
    grid.markLine({ start: new Point(15, 0), end: new Point(15, 30), kind: 'v' });

    expect(grid.hOv[1 * 3 + 0]).toBe(1);
    expect(grid.vOv[0]).toBe(0);
    expect(grid.vCost[1]).toBe(RouteCosts.CROSS / 2);
    expect(grid.hCost[1 * 3 + 1]).toBe(RouteCosts.CROSS);
  });

  it('splits a crossing on a grid line between both neighbours', () => {
    const grid = new RouteGrid(lines, lines);
    grid.markLine({ start: new Point(10, 5), end: new Point(10, 15), kind: 'v' });
    grid.markLine({ start: new Point(5, 20), end: new Point(15, 20), kind: 'h' });

    expect(grid.hCost[1 * 3 + 0]).toBe(RouteCosts.CROSS / 2);
    expect(grid.hCost[1 * 3 + 1]).toBe(RouteCosts.CROSS / 2);
    expect(grid.vCost[1 * 4 + 1]).toBe(RouteCosts.CROSS / 2);
    expect(grid.vCost[2 * 4 + 1]).toBe(RouteCosts.CROSS / 2);
  });

  it('charges a crossing near a line end double', () => {
    const grid = new RouteGrid(lines, lines);
    const end = new Point(15, 20);
    grid.markLine({ start: new Point(15, 0), end, kind: 'v', ends: [end] });

    expect(grid.hCost[1 * 3 + 1]).toBe(2 * RouteCosts.CROSS);
  });

  it('marks a shared tail apart from an overlap and a free line not at all', () => {
    const merged = new RouteGrid(lines, lines);
    merged.markLine({ start: new Point(20, 0), end: new Point(20, 30), kind: 'v', merge: true });
    const free = new RouteGrid(lines, lines);
    free.markLine({ start: new Point(5, 5), end: new Point(25, 25), kind: 'd', free: true });

    expect(merged.vMg[2]).toBe(1);
    expect(merged.vOv[2]).toBe(0);
    expect(free.hCost.every((cost) => cost === 0)).toBe(true);
  });

  it('charges a diagonal on the rows and columns it passes', () => {
    const grid = new RouteGrid(lines, lines);
    grid.markLine({ start: new Point(5, 5), end: new Point(25, 25), kind: 'd' });

    expect([...grid.hCost].some((cost) => cost > 0)).toBe(true);
    expect([...grid.vCost].some((cost) => cost > 0)).toBe(true);
  });

  it('bars the vertices of a gateway to everything but the way out', () => {
    const xs = [0, 10, 20, 30, 40];
    const grid = new RouteGrid(xs, xs);
    grid.guardVertices(new Box(10, 10, 20, 20));

    expect(grid.hCost[2 * 4 + 0]).toBe(0);
    expect(grid.hCost[2 * 4 + 1]).toBe(RouteCosts.HIT);
    expect(grid.vCost[0 * 5 + 2]).toBe(0);
    expect(grid.vCost[1 * 5 + 2]).toBe(RouteCosts.HIT);
  });

  it('makes turning right beside a shape expensive', () => {
    const xs = [0, 10, 20, 30, 40, 50];
    const grid = new RouteGrid(xs, xs);
    grid.markStubZones(new Box(20, 20, 10, 10), 15);

    expect(grid.turn[2 * 6 + 3 + 1]).toBe(RouteCosts.STUB_TURN);
    expect(grid.turn[2 * 6 + 1]).toBe(RouteCosts.STUB_TURN);
    expect(grid.turn[3 * 6 + 2 + 6]).toBe(RouteCosts.STUB_TURN);
    expect(grid.turn[1 * 6 + 2]).toBe(RouteCosts.STUB_TURN);
    expect(grid.turn[0]).toBe(0);
  });

  it('finds the node of a point on the grid and none beside it', () => {
    const grid = new RouteGrid(lines, lines);

    expect(grid.nodeOf(new Point(20, 10))).toBe(1 * 4 + 2);
    expect(grid.nodeOf(new Point(21, 10))).toBeUndefined();
    expect(grid.nodeOf(new Point(40, 40))).toBeUndefined();
  });

  it('walks the parents back into a route without its collinear points', () => {
    const grid = new RouteGrid(lines, lines);
    const state = (column: number, row: number): number => (row * 4 + column) * 4;
    const parent = new Int32Array(16 * 4).fill(-2);
    parent[state(0, 0)] = -1;
    parent[state(1, 0)] = state(0, 0);
    parent[state(2, 0)] = state(1, 0);
    parent[state(2, 1)] = state(2, 0);

    expect(grid.trace(state(2, 1), parent, 1)).toEqual([new Point(0, 0), new Point(20, 0), new Point(20, 10)]);
  });
});
