import { describe, expect, it } from 'vitest';
import { Scope } from '../../../../src/drawing/full/scopes/Scope.js';
import { Box, Point } from '../../../support/ModelValues.js';
import { ScopeSketch } from '../../../support/ScopeSketch.js';

describe('Scope', () => {
  function scoped() {
    const sketch = new ScopeSketch().node('task', 'a', 0, 0).boundary('event', 'a', 20).node('task', 'b', 200, 0).flow('a', 'b');
    const layout = sketch.layout();
    const edge = sketch.edge('a', 'b');
    edge.points = [new Point(100, 40), new Point(200, 40)];
    edge.label = new Box(110, 20, 20, 10);
    edge.bandY = 100;
    const data = ScopeSketch.artifact('bpmn:DataObjectReference', 'data', 'dataObject', { width: 36, height: 50 });
    const note = ScopeSketch.artifact('bpmn:TextAnnotation', 'note', 'annotation', { width: 100, height: 30 });
    const end = { box: new Box(150, 40, 0, 0), flow: edge };
    data.links.push({ el: data.el, id: 'link', from: end, to: end, points: [new Point(150, 40), new Point(400, 300)] });
    layout.artifacts.push(data, note);
    layout.compensations.push({ el: data.el, id: 'compensation', event: sketch.at('event'), handler: sketch.at('b'), points: [new Point(0, 500)] });
    return { sketch, layout, edge, data, end };
  }

  it('routes around shapes, boundary events and data, not around plain notes', () => {
    const { layout } = scoped();

    expect(new Scope(layout).routedArtifacts().map(({ id }) => id)).toEqual(['data']);
    expect(new Scope(layout).obstacles()).toHaveLength(4);
    expect(new Scope(layout).obstacles([])).toHaveLength(3);
  });

  it('counts a note on a boundary event as routed around', () => {
    const { sketch, layout } = scoped();
    layout.artifacts[1]!.anchorNode = sketch.at('event');

    expect(new Scope(layout).routedArtifacts()).toHaveLength(2);
  });

  it('lists the segments of its flows', () => {
    expect(new Scope(scoped().layout).routedSegments()).toHaveLength(1);
  });

  it('grows to hold its links and compensation lines', () => {
    const { layout } = scoped();

    new Scope(layout).growToFit();

    expect([layout.width, layout.height]).toEqual([400, 500]);
  });

  it('shifts everything once, a flow anchor used twice too', () => {
    const { sketch, layout, edge, data, end } = scoped();

    new Scope(layout).shift(10, 20);

    expect([sketch.at('event').box.x, edge.points[0]!.y, edge.label!.x, edge.bandY, data.box.x, end.box.x, layout.compensations[0]!.points[0]!.y]).toEqual([30, 60, 120, 120, 10, 160, 520]);
    expect([layout.width, layout.height]).toEqual([310, 100]);
  });
});
