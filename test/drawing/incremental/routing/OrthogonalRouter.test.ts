import { describe, expect, it } from 'vitest';
import { OrthogonalRouter } from '../../../../src/drawing/incremental/routing/OrthogonalRouter.js';
import { Box, Point, Polyline } from '../../../support/ModelValues.js';

describe('OrthogonalRouter', () => {
  const source = new Box(100, 100, 100, 80);
  const target = new Box(400, 100, 100, 80);

  it('draws a straight line between two shapes on one row', () => {
    expect(OrthogonalRouter.route({ source, target, obstacles: [] })).toEqual([new Point(200, 140), new Point(400, 140)]);
  });

  it('goes around a shape in the way with right angles only', () => {
    const blocker = new Box(260, 80, 80, 120);
    const route = new Polyline(OrthogonalRouter.route({ source, target, obstacles: [blocker] }));

    expect(route.isOrthogonal()).toBe(true);
    expect(route.hits(blocker)).toBe(false);
  });

  it('stays inside its frame while a way exists there', () => {
    const blocker = new Box(260, 110, 80, 60);
    const frame = new Box(60, 60, 500, 180);
    const points = OrthogonalRouter.route({ source, target, obstacles: [blocker], frame });

    expect(points.every((point) => frame.contains(point))).toBe(true);
    expect(new Polyline(points).hits(blocker)).toBe(false);
  });

  it('leaves the frame when the only clean way runs outside it', () => {
    const wall = new Box(260, 60, 80, 180);
    const frame = new Box(60, 60, 500, 180);
    const points = OrthogonalRouter.route({ source, target, obstacles: [wall], frame });

    expect(new Polyline(points).hits(wall)).toBe(false);
  });

  it('squeezes through a gap too narrow for the usual margin', () => {
    const upper = new Box(260, 0, 80, 136);
    const lower = new Box(260, 146, 80, 300);
    const points = OrthogonalRouter.route({ source, target, obstacles: [upper, lower], sourceSides: ['right'], targetSides: ['left'] });

    expect(new Polyline(points).hits(upper)).toBe(false);
    expect(new Polyline(points).hits(lower)).toBe(false);
  });

  it('accepts a hit when no way is free and still returns a route', () => {
    const ring = new Box(0, 0, 1000, 1000);

    expect(OrthogonalRouter.route({ source, target, obstacles: [ring], sourceSides: ['right'], targetSides: ['left'], margin: 2 }).length).toBeGreaterThanOrEqual(2);
  });

  it('enters a gateway in the middle of a side', () => {
    const gateway = new Box(400, 200, 50, 50);
    const points = OrthogonalRouter.route({ source, target: gateway, obstacles: [], targetMiddle: true, sourceMiddle: true });
    const last = points.at(-1)!;

    expect([last.x === 425, last.y === 225].some(Boolean)).toBe(true);
  });

  it('avoids the side another line took when it is told to', () => {
    const first = OrthogonalRouter.route({ source, target: new Box(400, 300, 100, 80), obstacles: [], sourceSides: ['right', 'bottom'], sourceAvoid: ['right'] });

    expect(first[0]?.y).toBe(180);
  });

  it('falls back on a direct line when nothing can be searched', () => {
    const nowhere = new Box(Number.POSITIVE_INFINITY, 0, 10, 10);
    const points = OrthogonalRouter.route({ source, target: nowhere, obstacles: [] });

    expect(points.length).toBeGreaterThanOrEqual(2);
  });

  it('joins a direct line through a middle for each pair of sides', () => {
    const below = new Box(Number.NaN, Number.NaN, 0, 0);

    expect(OrthogonalRouter.route({ source, target: below, obstacles: [], sourceSides: ['bottom'], targetSides: ['top'] }).length).toBeGreaterThanOrEqual(2);
    expect(OrthogonalRouter.route({ source, target: below, obstacles: [], sourceSides: ['bottom'], targetSides: ['left'] }).length).toBeGreaterThanOrEqual(2);
    expect(OrthogonalRouter.route({ source, target: below, obstacles: [], sourceSides: ['right'], targetSides: ['top'] }).length).toBeGreaterThanOrEqual(2);
  });
});
