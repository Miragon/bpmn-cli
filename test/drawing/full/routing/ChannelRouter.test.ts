import { describe, expect, it } from 'vitest';
import { ChannelRouter } from '../../../../src/drawing/full/routing/ChannelRouter.js';
import type { ScopeLayout } from '../../../../src/drawing/full/scopes/GNode.js';
import { Scope } from '../../../../src/drawing/full/scopes/Scope.js';
import { Box, Point, Polyline } from '../../../support/ModelValues.js';
import { RecordedScopes } from '../../../support/RecordedScopes.js';
import { ScopeSketch } from '../../../support/ScopeSketch.js';

function crossingPairs(lines: readonly Point[][]): number {
  let pairs = 0;
  lines.forEach((line, index) => {
    pairs += lines.slice(index + 1).filter((other) => new Polyline(line).crosses(new Polyline(other))).length;
  });
  return pairs;
}

function shapesCut(layout: ScopeLayout): number {
  const boxes = new Scope(layout).obstacles();
  return layout.edges.reduce((sum, edge) => sum + new Polyline(edge.points).hitCount(boxes, [edge.source.box, edge.target.box, ...(edge.source.host ? [edge.source.host.box] : [])]), 0);
}

describe('ChannelRouter', () => {
  it('draws a flow straight along one row', () => {
    const scope = new ScopeSketch().node('task', 'a', 0, 0).node('task', 'b', 200, 0).flow('a', 'b');

    new ChannelRouter(scope.layout()).route();

    expect(scope.points('a', 'b')).toEqual([[100, 40], [200, 40]]);
  });

  it('drops from the bottom of a split into the left side of a target below', () => {
    const scope = new ScopeSketch().node('gateway', 'split', 0, 0).node('task', 'b', 200, 150).flow('split', 'b');

    new ChannelRouter(scope.layout()).route();

    expect(scope.points('split', 'b')).toEqual([[25, 50], [25, 190], [200, 190]]);
  });

  it('rises into the bottom of a target above', () => {
    const scope = new ScopeSketch().node('task', 'low', 0, 200).node('task', 'high', 200, 0).flow('low', 'high');

    new ChannelRouter(scope.layout()).route();

    expect(scope.points('low', 'high').at(-1)).toEqual([250, 80]);
  });

  it('runs a loop below the shapes it spans and keeps it orthogonal', () => {
    const scope = new ScopeSketch().node('task', 'a', 0, 0).node('task', 'b', 200, 0).node('task', 'c', 400, 0).flow('a', 'b').flow('b', 'c').flow('c', 'a', { back: true });

    new ChannelRouter(scope.layout()).route();

    const loop = scope.edge('c', 'a').points;
    expect(new Polyline(loop).isOrthogonal()).toBe(true);
    expect(Math.max(...loop.map((point) => point.y))).toBeGreaterThan(80);
    expect(new Polyline(loop).hitsAny([scope.at('b').box], [])).toBe(false);
  });

  it('gives a nested loop the inner channel, as narrow spans route first', () => {
    const scope = new ScopeSketch().node('task', 'a', 0, 0).node('task', 'b', 200, 0).node('task', 'c', 400, 0).node('task', 'd', 600, 0).flow('a', 'b').flow('b', 'c').flow('c', 'd').flow('c', 'b', { back: true }).flow('d', 'a', { back: true });

    new ChannelRouter(scope.layout()).route();

    const deepest = (points: readonly Point[]): number => Math.max(...points.map((point) => point.y));
    expect(deepest(scope.edge('c', 'b').points)).toBeLessThan(deepest(scope.edge('d', 'a').points));
  });

  it('runs a self loop below its node and names it there', () => {
    const scope = new ScopeSketch().node('task', 'a', 0, 0).flow('a', 'a', { back: true, name: 'again' });

    new ChannelRouter(scope.layout()).route();

    expect(scope.points('a', 'a')).toEqual([[70, 80], [70, 120], [30, 120], [30, 80]]);
    expect(scope.edge('a', 'a').label?.y).toBe(124);
  });

  it('shifts the scope down when a loop over the top ran above zero', () => {
    const scope = new ScopeSketch().node('task', 'a', 0, 0).node('task', 'block', 200, 0, { height: 400 }).node('task', 'c', 400, 0).flow('a', 'block').flow('block', 'c').flow('c', 'a', { back: true });
    const layout = scope.layout();

    new ChannelRouter(layout).route();

    expect(Math.min(...layout.edges.flatMap((edge) => edge.points.map((point) => point.y)))).toBeGreaterThanOrEqual(0);
    expect(layout.height).toBeGreaterThanOrEqual(400);
  });

  it('marks the top of a shape a flow ends on as used', () => {
    const scope = new ScopeSketch().node('task', 'high', 0, 0).node('task', 'a', 300, 0).node('task', 'block', 150, 150).node('task', 'low', 300, 300).flow('high', 'a').flow('a', 'high', { back: true }).flow('high', 'low');

    new ChannelRouter(scope.layout()).route();

    expect([scope.at('high').topUsed, scope.at('a').topUsed]).toContain(false);
  });

  it('rises from its band, a boundary event from its run, else the centre of its source', () => {
    const scope = new ScopeSketch().node('task', 'a', 0, 0).boundary('event', 'a', 20).node('task', 'b', 200, 0).flow('a', 'b').flow('event', 'b');

    expect(ChannelRouter.riseFrom(scope.edge('a', 'b'))).toBe(40);
    expect(ChannelRouter.riseFrom(scope.edge('event', 'b'))).toBe(113);
    scope.edge('a', 'b').bandY = 300;
    expect(ChannelRouter.riseFrom(scope.edge('a', 'b'))).toBe(300);
  });

  it('places data off the centre, away from boundary events', () => {
    const plain = new ScopeSketch().node('task', 'a', 0, 0).node('gateway', 'g', 200, 0);
    const hosted = new ScopeSketch().node('task', 'a', 0, 0).boundary('event', 'a', 60).node('subProcess', 'sub', 200, 0).boundary('held', 'sub', 210);

    expect(ChannelRouter.dataX(plain.at('a'))).toBe(80);
    expect(ChannelRouter.dataX(plain.at('g'))).toBe(240);
    expect(ChannelRouter.dataX(hosted.at('a'))).toBe(20);
    expect(ChannelRouter.dataX(hosted.at('sub'))).toBe(280);
  });

  it('counts each crossing pair once, and a label a flow runs through', () => {
    const scope = new ScopeSketch().node('task', 'a', 0, 100).node('task', 'b', 200, 100).flow('a', 'b');
    const router = new ChannelRouter(scope.layout());
    router.route();

    expect(router.faults([new Box(120, 130, 40, 20), new Box(120, 300, 40, 20)])).toEqual({ crossings: 0, hits: 0, labels: 1 });
  });

  it.each(RecordedScopes.all().map((scope, index) => [index, scope] as const))('draws recorded scope %i with no more crossings and cuts than main', (_index, scope) => {
    const layout = RecordedScopes.layoutOf(scope);
    const main = RecordedScopes.layoutOf(scope);
    main.edges.forEach((edge, index) => {
      edge.points = scope.after.edges[index]!.points.map(([x, y]) => new Point(x, y));
    });
    const router = new ChannelRouter(layout);
    const startY = layout.nodes[0]?.box.y ?? 0;

    router.route();

    main.nodes.forEach((node) => node.shift(0, (layout.nodes[0]?.box.y ?? 0) - startY));
    new Scope(main).routedArtifacts().forEach((artifact) => artifact.box.translate(0, (layout.nodes[0]?.box.y ?? 0) - startY));
    expect(crossingPairs(layout.edges.map((edge) => edge.points))).toBeLessThanOrEqual(crossingPairs(main.edges.map((edge) => edge.points)));
    expect(shapesCut(layout)).toBeLessThanOrEqual(shapesCut(main));
    expect(layout.edges.every((edge) => edge.points.length >= 2)).toBe(true);
  });
});
