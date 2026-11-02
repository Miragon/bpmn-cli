import { describe, expect, it } from 'vitest';
import { AnnotationSpots } from '../../../../src/drawing/full/links/AnnotationSpots.js';
import { Box, Point } from '../../../support/ModelValues.js';
import { ScopeSketch } from '../../../support/ScopeSketch.js';

describe('AnnotationSpots', () => {
  const note = () => ScopeSketch.artifact('bpmn:TextAnnotation', 'note', 'annotation', { width: 100, height: 30 });

  it('puts a note above its anchor when that is free', () => {
    const sketch = new ScopeSketch().node('task', 'a', 100, 200);

    const box = new AnnotationSpots(sketch.layout()).spotOf(note(), sketch.at('a').box);

    expect(box?.bottom).toBeLessThan(200);
  });

  it('answers no spot above the top, so the note goes to the band', () => {
    const sketch = new ScopeSketch().node('task', 'a', 100, 0);

    expect(new AnnotationSpots(sketch.layout()).spotOf(note(), sketch.at('a').box)).toBeUndefined();
  });

  it('steps sideways when a taken spot lies above the anchor', () => {
    const sketch = new ScopeSketch().node('task', 'a', 300, 200);
    const spots = new AnnotationSpots(sketch.layout());
    const first = spots.spotOf(note(), sketch.at('a').box)!;
    spots.take(first);
    const sideways = note();
    sideways.anchor = sketch.at('a');

    expect(spots.spotOf(sideways, sketch.at('a').box)?.overlaps(first)).toBe(false);
  });

  it('keeps a note on a data object beside the data', () => {
    const sketch = new ScopeSketch().node('task', 'a', 100, 100);
    const layout = sketch.layout();
    const data = ScopeSketch.artifact('bpmn:DataObjectReference', 'data', 'dataObject', { width: 36, height: 50 });
    data.box = new Box(130, 220, 36, 50);
    layout.artifacts.push(data);
    const onData = note();
    onData.anchor = data;

    expect(new AnnotationSpots(layout).spotOf(onData, data.box)?.x).toBeGreaterThan(data.box.right);
  });

  it('settles a note under a flow when the spot above would cross into the lane above', () => {
    const sketch = new ScopeSketch().node('task', 'a', 100, 100).node('task', 'b', 400, 100).flow('a', 'b');
    const layout = sketch.layout();
    sketch.edge('a', 'b').points = [new Point(200, 225), new Point(400, 225)];
    layout.laneBands = [{ nodes: new Set(), top: 0, bottom: 200 }, { nodes: new Set(), top: 200, bottom: 400 }];
    const onFlow = note();
    onFlow.anchor = { box: new Box(300, 225, 0, 0), flow: sketch.edge('a', 'b') };

    expect(new AnnotationSpots(layout).spotOf(onFlow, onFlow.anchor.box)?.y).toBeGreaterThan(225);
  });
});
