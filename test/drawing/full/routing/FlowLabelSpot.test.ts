import { describe, expect, it } from 'vitest';
import { FlowLabelSpot } from '../../../../src/drawing/full/routing/FlowLabelSpot.js';
import { Point } from '../../../support/ModelValues.js';
import { ScopeSketch } from '../../../support/ScopeSketch.js';

describe('FlowLabelSpot', () => {
  function labelled(points: Point[], back = false) {
    const scope = new ScopeSketch().node('task', 'a', 0, 0).node('task', 'b', 300, 200).flow('a', 'b', { name: 'yes', back });
    const edge = scope.edge('a', 'b');
    edge.points = points;
    return edge;
  }

  it('gives an unnamed flow no label', () => {
    const scope = new ScopeSketch().node('task', 'a', 0, 0).node('task', 'b', 200, 0).flow('a', 'b');

    expect(new FlowLabelSpot(scope.edge('a', 'b')).box()).toBeUndefined();
  });

  it('puts the label near the start of the longest horizontal run', () => {
    const box = new FlowLabelSpot(labelled([new Point(0, 0), new Point(0, 100), new Point(200, 100)])).box()!;

    expect([box.x, box.bottom]).toEqual([8, 96]);
  });

  it('puts a loop label at the right end of its run', () => {
    const box = new FlowLabelSpot(labelled([new Point(0, 100), new Point(200, 100)], true)).box()!;

    expect(box.right).toBe(192);
  });

  it('puts the label beside a flow without a horizontal run', () => {
    const box = new FlowLabelSpot(labelled([new Point(50, 0), new Point(50, 100)])).box()!;

    expect([box.x, box.y]).toEqual([56, 6]);
  });
});
