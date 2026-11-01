import { describe, expect, it } from 'vitest';
import { ScopeLabels } from '../../../../src/drawing/full/scopes/ScopeLabels.js';
import { ScopeSketch } from '../../../support/ScopeSketch.js';

describe('ScopeLabels', () => {
  it('gives no label to an unnamed node', () => {
    const scope = new ScopeSketch().node('event', 'e', 0, 0);

    expect(ScopeLabels.of(scope.at('e'), 'event')).toBeUndefined();
  });

  it('puts an event label below, or above for a message flow docking at the bottom', () => {
    const scope = new ScopeSketch().node('event', 'e', 100, 100, { name: 'Done' });

    expect(ScopeLabels.of(scope.at('e'), 'event')!.y).toBe(142);
    expect(ScopeLabels.of(scope.at('e'), 'event', { above: true })!.bottom).toBe(94);
  });

  it('puts a gateway label above, to the upper left when a flow uses the top', () => {
    const scope = new ScopeSketch().node('gateway', 'g', 100, 100, { name: 'Ok?' });
    const centred = ScopeLabels.of(scope.at('g'), 'gateway')!;
    scope.at('g').topUsed = true;

    expect(Math.abs(centred.center.x - 125)).toBeLessThanOrEqual(1);
    expect(ScopeLabels.of(scope.at('g'), 'gateway')!.center.x).toBeLessThan(125);
  });

  it('hangs a boundary label below the host, a second event to the left', () => {
    const scope = new ScopeSketch().node('task', 'host', 0, 0).boundary('first', 'host', 10, { name: 'First' }).boundary('second', 'host', 60, { name: 'Second' });

    expect(ScopeLabels.of(scope.at('first'), 'boundary')!.x).toBe(50);
    expect(ScopeLabels.of(scope.at('second'), 'boundary')!.right).toBe(56);
  });

  it('staggers the labels of three boundary events', () => {
    const scope = new ScopeSketch().node('task', 'host', 0, 0).boundary('a', 'host', 0, { name: 'A' }).boundary('b', 'host', 30, { name: 'B' }).boundary('c', 'host', 60, { name: 'C' });

    expect(ScopeLabels.of(scope.at('a'), 'boundary')!.y).toBeLessThan(ScopeLabels.of(scope.at('c'), 'boundary')!.y);
  });

  it('puts a top border label above the host, left when asked', () => {
    const scope = new ScopeSketch().node('task', 'host', 0, 100).boundary('event', 'host', 30, { onTop: true, name: 'Timer' });
    const right = ScopeLabels.of(scope.at('event'), 'boundary')!;
    scope.at('event').labelLeft = true;

    expect(right.x).toBe(70);
    expect(right.bottom).toBe(98);
    expect(ScopeLabels.of(scope.at('event'), 'boundary')!.right).toBe(26);
  });

  it('collects the labels of shapes and flows, none for a sub-process', () => {
    const scope = new ScopeSketch().node('start', 's', 0, 0, { name: 'Go' }).node('subProcess', 'sub', 100, 0, { name: 'Sub' }).node('gateway', 'g', 300, 0, { name: 'Ok?' }).node('task', 'host', 500, 0).boundary('event', 'host', 510, { name: 'Late' }).flow('s', 'sub');
    const layout = scope.layout();
    const labels = new ScopeLabels(layout);
    scope.edge('s', 'sub').label = labels.shapes()[0]!.copy();

    expect(labels.shapes()).toHaveLength(3);
    expect(labels.ownShapes().map(([, node]) => node.id)).toEqual(['s', 'g', 'host']);
    expect(labels.all()).toHaveLength(4);
  });

  it('moves a data label that clashes with its neighbour', () => {
    const scope = new ScopeSketch().node('task', 'a', 0, 0);
    const layout = scope.layout();
    for (const id of ['one', 'two']) {
      const artifact = ScopeSketch.artifact('bpmn:DataObjectReference', id, 'dataObject', { width: 36, height: 50 }, 'Invoice document');
      artifact.box.translate(id === 'one' ? 0 : 40, 100);
      layout.artifacts.push(artifact);
    }
    const [first, second] = new ScopeLabels(layout).data();

    expect(first!.overlaps(second!, 2)).toBe(false);
  });

  it('counts the labels of a collapsed sub-process from the right', () => {
    const scope = new ScopeSketch().node('subProcess', 'sub', 0, 0).boundary('left', 'sub', 0, { name: 'L' }).boundary('right', 'sub', 40, { name: 'R' });

    expect(ScopeLabels.of(scope.at('left'), 'boundary')!.right).toBeLessThan(scope.at('left').box.x);
  });

  it('stacks a third label on the top border, and turns the first of two left', () => {
    const three = new ScopeSketch().node('task', 'host', 0, 100).boundary('a', 'host', 0, { onTop: true, name: 'A' }).boundary('b', 'host', 30, { onTop: true, name: 'B' }).boundary('c', 'host', 60, { onTop: true, name: 'C' });
    const two = new ScopeSketch().node('task', 'host', 0, 100).boundary('a', 'host', 0, { onTop: true, name: 'A' }).boundary('b', 'host', 60, { onTop: true, name: 'B' });

    expect(ScopeLabels.of(three.at('a'), 'boundary')!.y).toBeLessThan(ScopeLabels.of(three.at('c'), 'boundary')!.y);
    expect(ScopeLabels.of(two.at('a'), 'boundary')!.right).toBeLessThan(two.at('a').box.x);
  });

  it('measures a boundary event without a host at its own height', () => {
    const scope = new ScopeSketch().node('task', 'host', 0, 0).boundary('event', 'host', 0, { name: 'Lost' });
    scope.at('event').host = undefined;

    expect(ScopeLabels.of(scope.at('event'), 'boundary')!.y).toBe(scope.at('event').box.center.y + 2);
  });

  it('gives a note no label', () => {
    const scope = new ScopeSketch().node('task', 'a', 0, 0);
    const layout = scope.layout();
    layout.artifacts.push(ScopeSketch.artifact('bpmn:TextAnnotation', 'note', 'annotation', { width: 100, height: 30 }));

    expect(new ScopeLabels(layout).placedData()).toEqual([]);
  });

  it('labels an event sub-process and an expanded sub-process not at all', () => {
    const scope = new ScopeSketch().node('eventSubProcess', 'es', 0, 0, { name: 'Handler' }).node('task', 'a', 200, 0, { name: 'Task' });
    const layout = scope.layout();
    scope.at('a').child = ScopeSketch.emptyLayout(scope.at('a').el, [], []);

    expect(new ScopeLabels(layout).shapes()).toEqual([]);
  });
});
