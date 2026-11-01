import { describe, expect, it } from 'vitest';
import { ScopeArtifactPlacer } from '../../../../src/drawing/full/links/ScopeArtifactPlacer.js';
import { Box, Point } from '../../../support/ModelValues.js';
import { ScopeSketch } from '../../../support/ScopeSketch.js';

describe('ScopeArtifactPlacer', () => {
  const data = (id: string) => ScopeSketch.artifact('bpmn:DataObjectReference', id, 'dataObject', { width: 36, height: 50 });
  const note = (id: string) => ScopeSketch.artifact('bpmn:TextAnnotation', id, 'annotation', { width: 100, height: 30 });

  it('hangs data below their node, side by side, and unanchored data right of the content', () => {
    const sketch = new ScopeSketch().node('task', 'a', 0, 0);
    const layout = sketch.layout();
    const [first, second, loose] = [data('first'), data('second'), data('loose')];
    first.anchorNode = sketch.at('a');
    second.anchorNode = sketch.at('a');
    layout.artifacts.push(first, second, loose);

    new ScopeArtifactPlacer(layout).placeAttached();

    expect(first.box.y).toBeGreaterThan(80);
    expect(first.box.overlaps(second.box)).toBe(false);
    expect(loose.box.x).toBeGreaterThan(100);
  });

  it('hangs data right of the line rising into a join', () => {
    const sketch = new ScopeSketch().node('task', 'a', 0, 0).node('task', 'low', 0, 300).node('gateway', 'join', 300, 15).flow('a', 'join').flow('low', 'join');
    const layout = sketch.layout();
    const hanging = data('hanging');
    hanging.anchorNode = sketch.at('join');
    layout.artifacts.push(hanging);

    new ScopeArtifactPlacer(layout).placeAttached();

    expect(hanging.box.x).toBeGreaterThan(sketch.at('join').box.center.x);
  });

  it('places the note of a boundary event with the attached artifacts', () => {
    const sketch = new ScopeSketch().node('task', 'a', 300, 0).boundary('event', 'a', 360);
    const layout = sketch.layout();
    const onEvent = note('onEvent');
    onEvent.anchorNode = sketch.at('event');
    layout.artifacts.push(onEvent);

    new ScopeArtifactPlacer(layout).placeAttached();

    expect(onEvent.box.y).toBeGreaterThan(sketch.at('a').box.bottom);
  });

  it('moves the content down for a note without room above it, in anchor order', () => {
    const sketch = new ScopeSketch().node('task', 'a', 300, 0).node('task', 'b', 0, 0);
    const layout = sketch.layout();
    const [right, left, loose] = [note('right'), note('left'), note('loose')];
    right.anchor = sketch.at('a');
    left.anchor = sketch.at('b');
    layout.artifacts.push(right, left, loose);

    new ScopeArtifactPlacer(layout).placeAnnotations();

    expect(sketch.at('a').box.y).toBeGreaterThan(30);
    expect(left.box.x).toBeLessThan(right.box.x);
    expect(loose.box.x).toBeGreaterThan(right.box.x);
  });

  it('puts a flow end on the middle of the longest leg', () => {
    const sketch = new ScopeSketch().node('task', 'a', 0, 0).node('task', 'b', 300, 0).flow('a', 'b');
    const layout = sketch.layout();
    const edge = sketch.edge('a', 'b');
    edge.points = [new Point(100, 40), new Point(110, 40), new Point(110, 240)];
    const onFlow = note('onFlow');
    const end = { box: new Box(0, 0, 0, 0), flow: edge };
    onFlow.anchor = end;
    onFlow.links.push({ el: onFlow.el, id: 'line', from: onFlow, to: end, points: [] });
    layout.artifacts.push(onFlow);

    new ScopeArtifactPlacer(layout).refreshFlowAnchors();

    expect([end.box.x, end.box.y]).toEqual([110, 140]);
  });
});
