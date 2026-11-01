import { describe, expect, it } from 'vitest';
import { FlowPaths } from '../../../../src/drawing/full/routing/FlowPaths.js';
import { RoutingArea } from '../../../../src/drawing/full/routing/RoutingArea.js';
import { ScopeSketch } from '../../../support/ScopeSketch.js';

describe('FlowPaths', () => {
  function pathsOf(scope: ScopeSketch): { paths: FlowPaths; area: RoutingArea } {
    const area = new RoutingArea(scope.layout());
    return { area, paths: new FlowPaths(area) };
  }

  it('takes the first bottom slot that is clear and free', () => {
    const scope = new ScopeSketch().node('task', 'a', 0, 0).node('task', 'below', 0, 100, { width: 60 });
    const { paths, area } = pathsOf(scope);

    expect(paths.bottomSlot(scope.at('a'), 30)).toBe(75);
    area.usedBottom.take(scope.at('a'), 75, true);
    expect(paths.bottomSlot(scope.at('a'), 30)).toBe(75);
  });

  it('leaves through the gap beside a blocked bottom', () => {
    const scope = new ScopeSketch().node('task', 'a', 0, 0).node('task', 'block', 0, 120);
    const { paths } = pathsOf(scope);

    expect(paths.exitToBelow(scope.at('a'), 50, 300).map(({ x, y }) => [x, y])).toEqual([[100, 60], [130, 60], [130, 300]]);
  });

  it('hooks around a shape below the target through the gap right of it', () => {
    const scope = new ScopeSketch().node('task', 'target', 200, 0).node('task', 'block', 200, 100);
    const { paths } = pathsOf(scope);

    expect(paths.hookFromBelow(scope.at('target'), 300).map(({ x, y }) => [x, y])).toEqual([[330, 300], [330, 95], [250, 95], [250, 80]]);
  });

  it('goes straight in when the way up is free', () => {
    const scope = new ScopeSketch().node('task', 'target', 200, 0);
    const { paths } = pathsOf(scope);

    expect(paths.hookFromBelow(scope.at('target'), 300).map(({ x, y }) => [x, y])).toEqual([[250, 300], [250, 80]]);
  });

  it('claims a channel below the layers a flow spans', () => {
    const scope = new ScopeSketch().node('task', 'a', 0, 0).node('task', 'b', 300, 0);
    const { paths, area } = pathsOf(scope);

    const route = paths.channelRoute(scope.at('a'), scope.at('b'));

    expect(Math.max(...route.map((point) => point.y))).toBe(110);
    expect(area.channels.list).toHaveLength(1);
  });
});
