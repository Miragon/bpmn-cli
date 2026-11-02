import { describe, expect, it } from 'vitest';
import { DownRoute } from '../../../../src/drawing/full/routing/DownRoute.js';
import { FlowPaths } from '../../../../src/drawing/full/routing/FlowPaths.js';
import { RoutingArea } from '../../../../src/drawing/full/routing/RoutingArea.js';
import { ScopeSketch } from '../../../support/ScopeSketch.js';

describe('DownRoute', () => {
  function routed(scope: ScopeSketch, from: string, to: string) {
    const area = new RoutingArea(scope.layout());
    return { route: new DownRoute(area, new FlowPaths(area), scope.edge(from, to)).route(), area };
  }

  it('drops from the bottom and takes the slot', () => {
    const scope = new ScopeSketch().node('task', 'a', 0, 0).node('task', 'b', 200, 200).flow('a', 'b');

    const { route, area } = routed(scope, 'a', 'b');

    expect(route.points.map(({ x, y }) => [x, y])).toEqual([[50, 80], [50, 240], [200, 240]]);
    expect(area.usedBottom.taken(scope.at('a'), 50)).toBe(true);
  });

  it('leaves a join fed from below through its right vertex', () => {
    const scope = new ScopeSketch().node('gateway', 'join', 0, 100).node('task', 'x', -200, 300).node('task', 'y', -200, 500).node('task', 'b', 300, 400).flow('x', 'join').flow('y', 'join').flow('join', 'b');

    const { route } = routed(scope, 'join', 'b');

    expect(route.points[0]!.x).toBe(50);
    expect(route.points[1]!.x).toBe(65);
  });

  it('goes around a shape under the exit through the column gap', () => {
    const scope = new ScopeSketch().node('task', 'a', 0, 0).node('task', 'block', 0, 120).node('task', 'b', 200, 300).flow('a', 'b');

    const { route } = routed(scope, 'a', 'b');

    expect(route.points[0]!.x).toBe(100);
    expect(route.runsBelow).toBeUndefined();
  });

  it('runs a blocked boundary event below its host', () => {
    const scope = new ScopeSketch().node('task', 'host', 0, 0).boundary('event', 'host', 32).node('task', 'block', 0, 110, { width: 140 }).node('task', 'b', 300, 400).flow('event', 'b');

    const { route } = routed(scope, 'event', 'b');

    expect(route.runsBelow).toBe(true);
  });

  it('takes a channel when every way is blocked', () => {
    const scope = new ScopeSketch().node('task', 'a', 0, 0).node('task', 'block', 0, 110).node('task', 'wall', 110, 0, { height: 400 }).node('task', 'b', 300, 200).flow('a', 'b');

    const { route, area } = routed(scope, 'a', 'b');

    expect(area.channels.list).toHaveLength(1);
    expect(route.points).toHaveLength(5);
  });
});
