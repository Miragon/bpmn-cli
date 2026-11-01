import { describe, expect, it } from 'vitest';
import { BoundaryWays } from '../../../../src/drawing/full/routing/BoundaryWays.js';
import { FlowPaths } from '../../../../src/drawing/full/routing/FlowPaths.js';
import { RoutingArea } from '../../../../src/drawing/full/routing/RoutingArea.js';
import { ScopeSketch } from '../../../support/ScopeSketch.js';

describe('BoundaryWays', () => {
  function waysOf(scope: ScopeSketch, event: string, target: string, configure: (area: RoutingArea) => void = () => {}) {
    const area = new RoutingArea(scope.layout());
    configure(area);
    return new BoundaryWays(area, new FlowPaths(area), scope.at(event), scope.at(target));
  }

  it('offers a top border event the target top and the gap before its side', () => {
    const scope = new ScopeSketch().node('task', 'host', 0, 200).boundary('event', 'host', 32, { onTop: true }).node('task', 'target', 300, 0).flow('event', 'target');

    const ways = waysOf(scope, 'event', 'target').fromTopBorder().map((maker) => maker.make());

    expect(ways).toHaveLength(2);
    expect(ways[0]?.top).toBe(350);
    expect(ways[1]?.top).toBeUndefined();
  });

  it('offers no way into a target top a flow already leaves', () => {
    const scope = new ScopeSketch().node('task', 'host', 0, 200).boundary('event', 'host', 32, { onTop: true }).node('task', 'target', 300, 0).flow('event', 'target');
    const taken = waysOf(scope, 'event', 'target', (area) => area.usedTop.take(scope.at('target'), 350, true)).fromTopBorder();

    expect(taken).toHaveLength(1);
  });

  it('ranks the ways below by slot, then deeper, and those over the host last', () => {
    const scope = new ScopeSketch().node('task', 'host', 0, 300).boundary('event', 'host', 32).node('task', 'target', 300, 0).flow('event', 'target');

    const penalties = waysOf(scope, 'event', 'target').fromBottomBorder().map((maker) => maker.penalty ?? 0);

    expect(penalties[0]).toBe(0);
    expect(Math.max(...penalties)).toBeGreaterThanOrEqual(2.5);
  });

  it('keeps a boundary event of another lane below', () => {
    const scope = new ScopeSketch().node('task', 'host', 0, 300).boundary('event', 'host', 32).node('task', 'target', 300, 0).flow('event', 'target');
    const layout = scope.layout();
    layout.laneBands = [{ nodes: new Set([scope.at('host')]), top: 250, bottom: 500 }, { nodes: new Set([scope.at('target')]), top: 0, bottom: 200 }];
    const area = new RoutingArea(layout);

    const penalties = new BoundaryWays(area, new FlowPaths(area), scope.at('event'), scope.at('target')).fromBottomBorder().map((maker) => maker.penalty ?? 0);

    expect(Math.max(...penalties)).toBeLessThan(2.5);
  });

  it('skips a host gap beyond another event of the host', () => {
    const scope = new ScopeSketch().node('task', 'host', 100, 300).boundary('first', 'host', 120).boundary('second', 'host', 170).node('task', 'target', 500, 0).flow('first', 'target');

    const penalties = waysOf(scope, 'first', 'target').fromBottomBorder().map((maker) => maker.penalty ?? 0);

    expect(penalties.filter((penalty) => penalty >= 2.5 && penalty < 2.7)).toHaveLength(0);
  });

  it('makes a deeper way only when it runs lower than the near one', () => {
    const scope = new ScopeSketch().node('task', 'host', 0, 300).boundary('event', 'host', 32).node('task', 'target', 300, 0).node('task', 'deep', 200, 420).flow('event', 'target');

    const ways = waysOf(scope, 'event', 'target').fromBottomBorder();

    expect(ways[0]?.make()?.below).toBe(true);
    expect(ways[1]?.make()).toBeDefined();
  });
});
