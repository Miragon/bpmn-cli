import { describe, expect, it } from 'vitest';
import { RouteCosts } from '../../../../src/drawing/incremental/routing/RouteCosts.js';
import { RouteScene } from '../../../../src/drawing/incremental/routing/RouteScene.js';
import { Box, Point } from '../../../support/ModelValues.js';

describe('RouteScene', () => {
  const source = new Box(100, 100, 100, 80);
  const target = new Box(400, 100, 100, 80);

  it('takes the default margin and a stub of at least the shortest one', () => {
    expect(RouteScene.of({ source, target, obstacles: [] }).margin).toBe(15);
    expect(RouteScene.of({ source, target, obstacles: [], margin: 2 }).stub).toBe(RouteCosts.MIN_STUB);
    expect(RouteScene.of({ source, target, obstacles: [], margin: 40 }).stub).toBe(40);
  });

  it('drops an obstacle without valid coordinates', () => {
    const scene = RouteScene.of({ source, target, obstacles: [new Box(Number.NaN, 0, 1, 1), new Box(0, 0, -1, 1), new Box(300, 0, 10, 10)] });

    expect(scene.obstacles).toHaveLength(1);
  });

  it('keeps the ports and lines when it thins the margin', () => {
    const scene = RouteScene.of({ source, target, obstacles: [] });
    const thin = scene.thinned();

    expect(thin.margin).toBe(RouteCosts.THIN_MARGIN);
    expect(thin.src).toBe(scene.src);
    expect(thin.segs).toBe(scene.segs);
  });

  it('merges into the top or bottom ports of a join only', () => {
    const line = [new Point(450, 0), new Point(450, 100)];
    const scene = RouteScene.of({ source, target, obstacles: [], lines: [line], targetSides: ['top', 'left'], targetMerge: true });

    expect(scene.segs[0]?.merge).toBe(true);
  });

  it('counts each obstacle a route runs through as a hit', () => {
    const scene = RouteScene.of({ source, target, obstacles: [new Box(250, 120, 40, 40)] });

    expect(scene.score([new Point(200, 140), new Point(400, 140)]).hits).toBe(1);
    expect(scene.score([new Point(200, 80), new Point(400, 80)]).hits).toBe(0);
  });

  it('charges a crossing and a run along a line but not a free crossing', () => {
    const crossed = [new Point(300, 0), new Point(300, 300)];
    const along = [new Point(220, 140), new Point(380, 140)];
    const route = [new Point(200, 140), new Point(400, 140)];

    expect(RouteScene.of({ source, target, obstacles: [], lines: [crossed] }).score(route).penalty).toBe(RouteCosts.CROSS);
    expect(RouteScene.of({ source, target, obstacles: [], lines: [crossed], freeLines: new Set([crossed]) }).score(route).penalty).toBe(0);
    expect(RouteScene.of({ source, target, obstacles: [], lines: [along] }).score(route).penalty).toBe(RouteCosts.OVERLAP);
  });

  it('charges nothing for following the shared tail into a join', () => {
    const tail = [new Point(450, 0), new Point(450, 100)];
    const scene = RouteScene.of({ source, target, obstacles: [], lines: [tail], targetSides: ['top'], targetMerge: true });

    expect(scene.score([new Point(150, 100), new Point(150, 20), new Point(450, 20), new Point(450, 100)]).penalty).toBe(0);
  });
});
