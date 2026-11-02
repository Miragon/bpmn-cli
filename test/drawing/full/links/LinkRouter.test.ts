import { describe, expect, it } from 'vitest';
import { LinkRouter } from '../../../../src/drawing/full/links/LinkRouter.js';
import { Box, Point, Polyline } from '../../../support/ModelValues.js';
import { ScopeSketch } from '../../../support/ScopeSketch.js';

describe('LinkRouter', () => {
  it('runs a compensation line straight down, or with a step when the handler sits aside', () => {
    expect(LinkRouter.compensationPath(new Box(100, 0, 36, 36), new Box(50, 200, 100, 80))).toHaveLength(2);
    expect(LinkRouter.compensationPath(new Box(100, 0, 36, 36), new Box(300, 200, 100, 80))).toHaveLength(4);
  });

  function withData() {
    const sketch = new ScopeSketch().node('task', 'a', 0, 200).node('task', 'blocker', 0, 100);
    const layout = sketch.layout();
    const data = ScopeSketch.artifact('bpmn:DataObjectReference', 'data', 'dataObject', { width: 36, height: 50 });
    data.box = new Box(32, 0, 36, 50);
    data.anchorNode = sketch.at('a');
    data.links.push({ el: data.el, id: 'line', from: data, to: sketch.at('a'), points: [] });
    layout.artifacts.push(data);
    return { sketch, layout, data };
  }

  it('routes a data line around a shape in its way', () => {
    const { sketch, layout, data } = withData();

    new LinkRouter(layout).route();

    expect(new Polyline(data.links[0]!.points).hits(sketch.at('blocker').box)).toBe(false);
    expect(data.links[0]!.points[0]!.y).toBeLessThan(100);
  });

  it('turns a line reversed when the artifact is the target', () => {
    const { sketch, layout, data } = withData();
    data.links[0]!.from = sketch.at('a');
    data.links[0]!.to = data;

    new LinkRouter(layout).route();

    expect(data.links[0]!.points[0]!.y).toBeGreaterThan(data.links[0]!.points.at(-1)!.y);
  });

  it('keeps an annotation line in the lane both ends lie in, and off a lane border', () => {
    const sketch = new ScopeSketch().node('task', 'a', 300, 100);
    const layout = sketch.layout();
    const note = ScopeSketch.artifact('bpmn:TextAnnotation', 'note', 'annotation', { width: 100, height: 30 });
    note.box = new Box(0, 110, 100, 30);
    note.links.push({ el: ScopeSketch.element('bpmn:Association', 'line'), id: 'line', from: note, to: sketch.at('a'), points: [] });
    layout.artifacts.push(note);
    layout.laneBands = [{ nodes: new Set(), top: 50, bottom: 300 }];

    new LinkRouter(layout, true).route();

    expect(note.links[0]!.points.every((point) => point.y >= 50 && point.y <= 300)).toBe(true);
  });

  it('lets two annotation lines into one target join and draws a line to a flow', () => {
    const sketch = new ScopeSketch().node('task', 'a', 0, 200).node('task', 'b', 400, 200).flow('a', 'b');
    const layout = sketch.layout();
    const edge = sketch.edge('a', 'b');
    edge.points = [new Point(100, 240), new Point(400, 240)];
    const end = { box: new Box(250, 240, 0, 0), flow: edge };
    const notes = ['left', 'right'].map((id, index) => {
      const note = ScopeSketch.artifact('bpmn:TextAnnotation', id, 'annotation', { width: 100, height: 30 });
      note.box = new Box(100 + index * 150, 100, 100, 30);
      note.links.push({ el: ScopeSketch.element('bpmn:Association', `${id}_line`), id: `${id}_line`, from: note, to: end, points: [] });
      return note;
    });
    layout.artifacts.push(...notes);

    new LinkRouter(layout, true).route();

    expect(notes.every((note) => note.links[0]!.points.at(-1)!.y === 240)).toBe(true);
  });
});
