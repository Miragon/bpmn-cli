import { describe, expect, it } from 'vitest';
import { RoutingArea } from '../../../../src/drawing/full/routing/RoutingArea.js';
import { XIndex } from '../../../../src/drawing/full/scopes/XIndex.js';
import { Point, Polyline, type Segment } from '../../../support/ModelValues.js';
import { ScopeSketch } from '../../../support/ScopeSketch.js';

describe('RoutingArea', () => {
  const across = new Polyline([new Point(0, 50), new Point(100, 50)]).segments();

  it('counts crossings on a list and on an index, and stops at the limit', () => {
    const index = new XIndex<Segment>();
    index.add(across[0]!, 0, 100);
    const line = [new Point(20, 0), new Point(20, 100), new Point(60, 100), new Point(60, 0)];

    expect(RoutingArea.crossingsOf(line, across)).toBe(2);
    expect(RoutingArea.crossingsOf(line, index)).toBe(2);
    expect(RoutingArea.crossingsOf(line, across, 1)).toBe(1);
  });

  it('draws one y for both ends of a straight line', () => {
    const scope = new ScopeSketch().node('task', 'a', 0, 0).node('gateway', 'b', 200, 15).flow('a', 'b');

    expect(RoutingArea.straightLine(scope.edge('a', 'b')).map(({ x, y }) => [x, y])).toEqual([[100, 40], [200, 40]]);
  });

  it('finds the empty branch whose row is open, not one a shape blocks', () => {
    const open = new ScopeSketch().node('gateway', 'split', 0, 0).node('gateway', 'join', 300, 0).flow('split', 'join', { bandY: 100 });
    const blocked = new ScopeSketch().node('gateway', 'split', 0, 0).node('task', 'block', 120, -15).node('gateway', 'join', 300, 0).flow('split', 'join', { bandY: 100 });

    expect(new RoutingArea(open.layout()).openRow.size).toBe(1);
    expect(new RoutingArea(blocked.layout()).openRow.size).toBe(0);
  });

  it('reads what stands in an x range, inside a lane band only when given one', () => {
    const scope = new ScopeSketch().node('task', 'a', 0, 0).node('task', 'b', 0, 300, { name: 'far' });
    const area = new RoutingArea(scope.layout());

    expect(area.rangeBottom(0, 100)).toBe(380);
    expect(area.rangeBottom(0, 100, { nodes: new Set(), top: 0, bottom: 100 })).toBe(80);
    expect(area.rangeTop(0, 100, { nodes: new Set(), top: 200, bottom: 400 })).toBe(300);
    expect(area.rangeTop(500, 600)).toBe(0);
  });

  it('knows the band of a boundary event by its host', () => {
    const scope = new ScopeSketch().node('task', 'host', 0, 0).boundary('event', 'host', 40);
    const layout = scope.layout();
    const band = { nodes: new Set([scope.at('host')]), top: 0, bottom: 200 };
    layout.laneBands = [band];

    expect(new RoutingArea(layout).bandOf(scope.at('event'))).toBe(band);
  });

  it('sees a line as taken by a routed flow on it or a flow label on it', () => {
    const scope = new ScopeSketch().node('task', 'a', 0, 0).node('task', 'b', 300, 0).flow('a', 'b');
    const area = new RoutingArea(scope.layout());
    const edge = scope.edge('a', 'b');
    edge.points = [new Point(100, 40), new Point(300, 40)];
    area.record(edge, true);

    expect(area.lineFree([new Point(150, 40), new Point(250, 40)])).toBe(false);
    expect(area.lineFree([new Point(150, 90), new Point(250, 90)])).toBe(true);
    expect(area.onRouted([new Point(150, 40), new Point(250, 40)])).toBe(true);
    expect(area.onRouted([new Point(150, 40), new Point(250, 40)], area.overTop)).toBe(true);
    expect(area.onRouted([new Point(150, 41), new Point(250, 41)])).toBe(false);
  });

  it('reads the horizontal runs in reach as flat boxes', () => {
    const scope = new ScopeSketch().node('task', 'a', 0, 0).node('task', 'b', 300, 0).flow('a', 'b');
    const area = new RoutingArea(scope.layout());
    const edge = scope.edge('a', 'b');
    edge.points = [new Point(100, 40), new Point(300, 40)];
    area.record(edge, false);

    expect(area.runArea(0, 500).filter((box) => box.height === 0)).toHaveLength(1);
  });

  it('sums the lowest shape of a span of layers', () => {
    const scope = new ScopeSketch().node('task', 'a', 0, 0, { layer: 0 }).node('task', 'b', 200, 300, { layer: 5 });

    expect(new RoutingArea(scope.layout()).spanBottom(0, 1)).toBe(80);
  });
});
