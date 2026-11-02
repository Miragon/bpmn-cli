import { describe, expect, it } from 'vitest';
import { RouteGridBuilder } from '../../../../src/drawing/incremental/grid/RouteGridBuilder.js';
import { RouteCosts } from '../../../../src/drawing/incremental/routing/RouteCosts.js';
import { RouteScene } from '../../../../src/drawing/incremental/routing/RouteScene.js';
import { Box, Point } from '../../../support/ModelValues.js';

describe('RouteGridBuilder', () => {
  const source = new Box(100, 100, 100, 80);
  const target = new Box(400, 300, 100, 80);

  it('lays grid lines through the ports, the stubs and the middle between both shapes', () => {
    const { xs, ys } = new RouteGridBuilder(RouteScene.of({ source, target, obstacles: [] }), undefined).grid(false);

    expect(xs).toContain(200);
    expect(xs).toContain(215);
    expect(xs).toContain(300);
    expect(ys).toContain(140);
    expect(ys).toContain(240);
  });

  it('takes a middle on the other side when the target lies left and above', () => {
    const { xs, ys } = new RouteGridBuilder(RouteScene.of({ source: target, target: source, obstacles: [] }), undefined).grid(false);

    expect(xs).toContain(300);
    expect(ys).toContain(240);
  });

  it('charges an obstacle and widens the region only on a wide search', () => {
    const far = new Box(1000, 140, 100, 80);
    const scene = RouteScene.of({ source, target, obstacles: [new Box(300, 200, 40, 40), far] });
    const narrow = new RouteGridBuilder(scene, undefined).grid(false);
    const wide = new RouteGridBuilder(scene, undefined).grid(true);

    expect(narrow.xs.at(-1)).toBeLessThan(1000);
    expect(wide.xs.at(-1)).toBeGreaterThan(1100);
    expect(Math.max(...wide.hCost)).toBeGreaterThanOrEqual(RouteCosts.HIT);
  });

  it('keeps every grid line inside a frame and offers a line along its inside', () => {
    const frame = new Box(50, 50, 500, 400);
    const { xs, ys } = new RouteGridBuilder(RouteScene.of({ source, target, obstacles: [], frame }), frame).grid(false);

    expect(Math.min(...xs)).toBeGreaterThanOrEqual(50);
    expect(Math.max(...ys)).toBeLessThanOrEqual(450);
    expect(xs).toContain(65);
    expect(ys).toContain(435);
  });

  it('notes overlaps and shared tails of the lines it passes, not of distant ones', () => {
    const scene = RouteScene.of({ source, target, obstacles: [], lines: [[new Point(100, 140), new Point(500, 140)], [new Point(9000, 9000), new Point(9100, 9000)]] });
    const grid = new RouteGridBuilder(scene, undefined).grid(false);

    expect(grid.anyOv).toBe(true);
    expect(grid.anyMg).toBe(false);
  });

  it('guards the vertices of a gateway target', () => {
    const scene = RouteScene.of({ source, target: new Box(400, 115, 50, 50), obstacles: [], targetMiddle: true, margin: 0 });

    expect(Math.max(...new RouteGridBuilder(scene, undefined).grid(false).hCost)).toBeGreaterThanOrEqual(RouteCosts.HIT);
  });
});
