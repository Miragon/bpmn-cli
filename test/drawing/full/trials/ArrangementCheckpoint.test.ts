import { describe, expect, it } from 'vitest';
import { ArrangementCheckpoint } from '../../../../src/drawing/full/trials/ArrangementCheckpoint.js';
import { Box, Point } from '../../../support/ModelValues.js';
import { ScopeSketch } from '../../../support/ScopeSketch.js';

describe('ArrangementCheckpoint', () => {
  it('puts a rejected arrangement back exactly', () => {
    const sketch = new ScopeSketch().node('task', 'a', 0, 0).boundary('event', 'a', 10).node('task', 'b', 200, 0).flow('a', 'b');
    const layout = sketch.layout();
    const edge = sketch.edge('a', 'b');
    edge.points = [new Point(100, 40), new Point(200, 40)];
    layout.laneBands = [{ nodes: new Set(), top: 0, bottom: 100 }];
    const checkpoint = new ArrangementCheckpoint(layout);

    sketch.at('a').box = new Box(500, 500, 100, 80);
    sketch.at('event').onTop = true;
    edge.points = [];
    edge.bandY = 70;
    layout.width = 9000;
    layout.laneBands = [];
    checkpoint.restore();

    expect(sketch.at('a').box.x).toBe(0);
    expect(sketch.at('event').onTop).toBeUndefined();
    expect(edge.points).toHaveLength(2);
    expect(edge.bandY).toBeUndefined();
    expect(layout.width).not.toBe(9000);
    expect(layout.laneBands).toHaveLength(1);
  });

  it('holds artifacts and compensation lines too', () => {
    const sketch = new ScopeSketch().node('task', 'a', 0, 0);
    const layout = sketch.layout();
    const data = ScopeSketch.artifact('bpmn:DataObjectReference', 'data', 'dataObject', { width: 36, height: 50 });
    layout.artifacts.push(data);
    layout.compensations.push({ el: data.el, id: 'line', event: sketch.at('a'), handler: sketch.at('a'), points: [new Point(1, 1)] });
    const checkpoint = new ArrangementCheckpoint(layout);

    data.box = new Box(9, 9, 9, 9);
    layout.compensations[0]!.points = [];
    checkpoint.restore();

    expect(data.box.x).toBe(0);
    expect(layout.compensations[0]!.points).toHaveLength(1);
  });
});
