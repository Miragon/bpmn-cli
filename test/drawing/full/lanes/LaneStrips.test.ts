import { describe, expect, it } from 'vitest';
import { LaneStrips } from '../../../../src/drawing/full/lanes/LaneStrips.js';
import { Point } from '../../../support/ModelValues.js';
import { ScopeSketch } from '../../../support/ScopeSketch.js';

describe('LaneStrips', () => {
  function drawn() {
    const sketch = new ScopeSketch().node('task', 'up', 0, 0).node('task', 'low', 0, 200).flow('up', 'low').flow('low', 'up', { back: true });
    const edge = sketch.edge('up', 'low');
    edge.points = [new Point(50, 80), new Point(50, 200)];
    const back = sketch.edge('low', 'up');
    back.points = [new Point(10, 200), new Point(10, 80)];
    return { sketch, layout: sketch.layout(), edge, back };
  }

  it('moves everything at or below the cut down, and keeps what it is told to keep', () => {
    const { sketch, layout, edge, back } = drawn();
    const height = layout.height;

    new LaneStrips(layout, []).open(150, 40, new Set([back]));

    expect(sketch.at('low').box.y).toBe(240);
    expect(sketch.at('up').box.y).toBe(0);
    expect(edge.points.map((point) => point.y)).toEqual([80, 240]);
    expect(back.points[0]!.y).toBe(200);
    expect(layout.height).toBe(height + 40);
  });

  it('finds a free spot for a wide shape beside the flows crossing the cut', () => {
    const { layout } = drawn();

    expect(new LaneStrips(layout, []).freeX(150, 200)).toBe(70);
  });
});
