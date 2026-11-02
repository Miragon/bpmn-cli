import { describe, expect, it } from 'vitest';
import { FlowPaths } from '../../../../src/drawing/full/routing/FlowPaths.js';
import { RoutingArea } from '../../../../src/drawing/full/routing/RoutingArea.js';
import { SameRowRoute } from '../../../../src/drawing/full/routing/SameRowRoute.js';
import { ScopeSketch } from '../../../support/ScopeSketch.js';

describe('SameRowRoute', () => {
  function routed(scope: ScopeSketch, from: string, to: string) {
    const area = new RoutingArea(scope.layout());
    return { route: new SameRowRoute(area, new FlowPaths(area)).of(scope.edge(from, to)), area };
  }

  it('draws a flow around a shape on its row through a channel', () => {
    const scope = new ScopeSketch().node('task', 'a', 0, 0).node('task', 'block', 200, 0).node('task', 'b', 400, 0).flow('a', 'b');

    const { route } = routed(scope, 'a', 'b');

    expect(Math.max(...route.points.map((point) => point.y))).toBeGreaterThan(80);
  });

  it('draws an empty branch straight on its free row and takes the left vertex of the join', () => {
    const scope = new ScopeSketch().node('gateway', 'split', 0, 0).node('gateway', 'join', 300, 0).flow('split', 'join', { bandY: 100 });

    const { route, area } = routed(scope, 'split', 'join');

    expect(route.points.map(({ y }) => y)).toEqual([25, 25]);
    expect(area.leftTaken.has(scope.at('join'))).toBe(true);
  });

  it('runs an empty branch in its band when its row is not free', () => {
    const scope = new ScopeSketch().node('gateway', 'split', 0, 0).node('task', 'block', 100, -15).node('gateway', 'join', 300, 0).flow('split', 'join', { bandY: 100 });

    const { route, area } = routed(scope, 'split', 'join');

    expect(route.points[1]!.y).toBe(100);
    expect(area.usedBottom.taken(scope.at('split'), 25)).toBe(true);
  });
});
