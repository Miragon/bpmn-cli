import { describe, expect, it } from 'vitest';
import { LoopRoute } from '../../../../src/drawing/full/routing/LoopRoute.js';
import { RoutingArea } from '../../../../src/drawing/full/routing/RoutingArea.js';
import { Polyline } from '../../../support/ModelValues.js';
import { ScopeSketch } from '../../../support/ScopeSketch.js';

describe('LoopRoute', () => {
  function routed(scope: ScopeSketch, from: string, to: string) {
    const area = new RoutingArea(scope.layout());
    return { route: new LoopRoute(area, scope.edge(from, to)).route(), area };
  }

  it('prefers the channel below', () => {
    const scope = new ScopeSketch().node('task', 'a', 0, 0).node('task', 'b', 300, 0).flow('b', 'a', { back: true });

    const { route } = routed(scope, 'b', 'a');

    expect(route.channel?.y).toBe(110);
    expect(route.channel?.list).toBeDefined();
  });

  it('goes over the top when a shape blocks every way below', () => {
    const scope = new ScopeSketch().node('task', 'a', 0, 0).node('task', 'b', 300, 0).node('task', 'below_the_lane', -100, 100, { width: 600, height: 300 }).flow('b', 'a', { back: true });
    const layout = scope.layout();
    layout.laneBands = [{ nodes: new Set([scope.at('a'), scope.at('b')]), top: 0, bottom: 95 }];
    const area = new RoutingArea(layout);

    const route = new LoopRoute(area, scope.edge('b', 'a')).route();

    expect(route.channel?.list).toBe(area.topChannels);
    expect(route.points.some((point) => point.y < 0)).toBe(true);
  });

  it('enters a gateway at its left vertex when its bottom is taken', () => {
    const scope = new ScopeSketch().node('gateway', 'join', 0, 0).node('task', 'b', 300, 0).flow('b', 'join', { back: true });
    const area = new RoutingArea(scope.layout());
    area.usedBottom.take(scope.at('join'), 25, true);
    area.usedTop.take(scope.at('join'), 25, true);

    const { points } = new LoopRoute(area, scope.edge('b', 'join')).route();

    expect(points.at(-1)).toMatchObject({ x: 0, y: 25 });
  });

  it('runs a loop into a target far below straight down', () => {
    const scope = new ScopeSketch().node('task', 'a', 300, 0).node('task', 'b', 0, 400).node('task', 'below_the_lane', -100, 500, { width: 600, height: 300 }).flow('a', 'b', { back: true });
    const layout = scope.layout();
    layout.laneBands = [{ nodes: new Set([scope.at('a'), scope.at('b')]), top: 0, bottom: 490 }];

    const route = new LoopRoute(new RoutingArea(layout), scope.edge('a', 'b')).route();

    expect(route.channel).toBeUndefined();
    expect(new Polyline(route.points).isOrthogonal()).toBe(true);
  });

  it('keeps inside a shared lane band', () => {
    const scope = new ScopeSketch().node('task', 'a', 0, 0).node('task', 'b', 300, 0).node('task', 'other', 150, 300).flow('b', 'a', { back: true });
    const layout = scope.layout();
    layout.laneBands = [{ nodes: new Set([scope.at('a'), scope.at('b')]), top: 0, bottom: 200 }];

    const route = new LoopRoute(new RoutingArea(layout), scope.edge('b', 'a')).route();

    expect(route.channel?.y).toBe(110);
  });
});
