import { describe, expect, it } from 'vitest';
import { DEdge } from '../../../src/drawing/plane/DEdge.js';
import { Box, Point } from '../../support/ModelValues.js';
import { ScopeSketch } from '../../support/ScopeSketch.js';

describe('DEdge', () => {
  const edge = (points: Point[]): DEdge => new DEdge('flow', ScopeSketch.element('bpmn:SequenceFlow', 'flow'), 'sequenceFlow', points);
  const size = { width: 40, height: 14 };

  it('moves its waypoints and label along', () => {
    const moved = edge([new Point(0, 0), new Point(100, 0)]);
    moved.label = new Box(10, 10, 40, 14);

    moved.translate(5, 7);

    expect([moved.points[1]!.x, moved.label.y]).toEqual([105, 17]);
  });

  it('tells on which side of the nearest segment a label sits', () => {
    const line = edge([new Point(0, 100), new Point(200, 100), new Point(200, 300)]);

    expect(line.labelSide()).toBeUndefined();
    line.label = new Box(80, 70, 40, 14);
    expect(line.labelSide()).toBe('above');
    line.label = new Box(80, 110, 40, 14);
    expect(line.labelSide()).toBe('below');
    line.label = new Box(210, 200, 40, 14);
    expect(line.labelSide()).toBe('right');
    line.label = new Box(150, 200, 40, 14);
    expect(line.labelSide()).toBe('left');
  });

  it('has no label side with fewer than two points', () => {
    const point = edge([new Point(0, 0)]);
    point.label = new Box(0, 0, 10, 10);

    expect(point.labelSide()).toBeUndefined();
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
