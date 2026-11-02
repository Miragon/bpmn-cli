import { describe, expect, it } from 'vitest';
import { PlaneEdge } from '../../../src/drawing/plane/PlaneEdge.js';
import { Box, Point } from '../../support/ModelValues.js';
import { ScopeSketch } from '../../support/ScopeSketch.js';

describe('PlaneEdge', () => {
  const edge = (points: Point[]): PlaneEdge => new PlaneEdge('flow', ScopeSketch.element('bpmn:SequenceFlow', 'flow'), 'sequenceFlow', points);
  const size = { width: 40, height: 14 };

  it('moves its waypoints and label along', () => {
    const moved = edge([new Point(0, 0), new Point(100, 0)]);
    moved.label = new Box(10, 10, 40, 14);

    moved.translate(5, 7);

    expect([moved.points[1]!.x, moved.label.y]).toEqual([105, 17]);
  });

  it('places a label beside the longest straight run on the side asked', () => {
    const line = edge([new Point(0, 100), new Point(200, 100), new Point(200, 150)]);

    expect(line.labelAt(size, 'above')).toMatchObject({ x: 80, y: 82 });
    expect(line.labelAt(size, 'below')).toMatchObject({ x: 80, y: 104 });
    expect(line.labelAt(size, 'right')).toMatchObject({ x: 206, y: 118 });
    expect(line.labelAt(size, 'left')).toMatchObject({ x: 154, y: 118 });
  });

  it('finds no spot on a diagonal line', () => {
    expect(edge([new Point(0, 0), new Point(100, 100)]).labelAt(size, 'above')).toBeUndefined();
  });
});
