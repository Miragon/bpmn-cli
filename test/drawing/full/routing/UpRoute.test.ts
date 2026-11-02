import { describe, expect, it } from 'vitest';
import { FlowPaths } from '../../../../src/drawing/full/routing/FlowPaths.js';
import { RoutingArea } from '../../../../src/drawing/full/routing/RoutingArea.js';
import { UpRoute } from '../../../../src/drawing/full/routing/UpRoute.js';
import { ScopeSketch } from '../../../support/ScopeSketch.js';

describe('UpRoute', () => {
  function routed(scope: ScopeSketch, from: string, to: string) {
    const area = new RoutingArea(scope.layout());
    return { route: new UpRoute(area, new FlowPaths(area), scope.edge(from, to)).route(), area };
  }

  it('leaves the right side and rises into the bottom', () => {
    const scope = new ScopeSketch().node('task', 'low', 0, 300).node('task', 'high', 200, 0).flow('low', 'high');

    const { route, area } = routed(scope, 'low', 'high');

    expect(route.points.map(({ x, y }) => [x, y])).toEqual([[100, 340], [250, 340], [250, 80]]);
    expect(area.usedBottom.taken(scope.at('high'), 250)).toBe(true);
  });

  it('avoids a shape on the way up by the next way', () => {
    const scope = new ScopeSketch().node('task', 'low', 0, 300).node('task', 'block', 200, 150).node('task', 'high', 200, 0).flow('low', 'high');

    const { route } = routed(scope, 'low', 'high');

    expect(new Set(route.points.map(({ x }) => x)).has(250)).toBe(true);
    expect(route.points.length).toBeGreaterThan(3);
  });

  it('takes a channel when every way cuts a shape', () => {
    const scope = new ScopeSketch().node('task', 'low', 0, 300).node('task', 'wall', 110, 0, { height: 600 }).node('task', 'high', 0, 0, { width: 100 }).flow('low', 'high');

    const { area } = routed(scope, 'low', 'high');

    expect(area.channels.list.length).toBeLessThanOrEqual(1);
  });

  it('flies a boundary event from the top border over the top', () => {
    const scope = new ScopeSketch().node('task', 'host', 0, 200).boundary('event', 'host', 32, { onTop: true }).node('task', 'target', 300, 0).flow('event', 'target');

    const { route } = routed(scope, 'event', 'target');

    expect(route.runsAbove).toBe(true);
    expect(route.channel).toBeDefined();
  });

  it('runs a boundary event below its host before it rises', () => {
    const scope = new ScopeSketch().node('task', 'host', 0, 300).boundary('event', 'host', 32).node('task', 'target', 300, 0).flow('event', 'target');

    const { route } = routed(scope, 'event', 'target');

    expect(route.runsBelow).toBe(true);
    expect(route.points.at(-1)).toMatchObject({ y: 80 });
  });
});
