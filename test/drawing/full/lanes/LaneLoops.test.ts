import { describe, expect, it } from 'vitest';
import { LaneLoops } from '../../../../src/drawing/full/lanes/LaneLoops.js';
import type { LaneBand } from '../../../../src/drawing/full/lanes/LaneTree.js';
import { Point } from '../../../support/ModelValues.js';
import { ScopeSketch } from '../../../support/ScopeSketch.js';

describe('LaneLoops', () => {
  function laned(loopY: number) {
    const sketch = new ScopeSketch().node('task', 'a', 0, 40).node('task', 'b', 200, 40).node('task', 'c', 0, 240).flow('a', 'b').flow('b', 'a', { back: true });
    const layout = sketch.layout();
    const lanes: LaneBand[] = [
      { el: layout.el, id: 'one', nodes: [sketch.at('a'), sketch.at('b')], subs: [], children: [], y: 0, height: 160 },
      { el: layout.el, id: 'two', nodes: [sketch.at('c')], subs: [], children: [], y: 160, height: 160 },
    ];
    layout.laneBands = lanes.map((lane) => ({ nodes: new Set(lane.nodes), top: lane.y, bottom: lane.y + lane.height }));
    sketch.edge('b', 'a').points = [new Point(250, 120), new Point(250, loopY), new Point(50, loopY), new Point(50, 120)];
    sketch.edge('a', 'b').points = [new Point(100, 80), new Point(200, 80)];
    return { sketch, layout, lanes };
  }

  it('grows a lane around a loop laid on its bottom border', () => {
    const { layout, lanes } = laned(155);

    new LaneLoops(layout, lanes).fit();

    expect(lanes[0]!.height).toBeGreaterThan(160);
    expect(lanes[1]!.y).toBe(lanes[0]!.height);
  });

  it('grows the lane upwards for a loop over its top, moving its content down', () => {
    const { sketch, layout, lanes } = laned(-10);

    new LaneLoops(layout, lanes).fit();

    expect(lanes[0]!.height).toBeGreaterThan(160);
    expect(sketch.at('a').box.y).toBeGreaterThan(40);
    expect(Math.min(...sketch.edge('b', 'a').points.map((point) => point.y))).toBeGreaterThanOrEqual(lanes[0]!.y);
  });

  it('lets the first lane take a strip the content moved down by', () => {
    const { layout, lanes } = laned(100);
    const loops = new LaneLoops(layout, lanes);

    loops.growFirstLane(30, false);

    expect([lanes[0]!.y, lanes[0]!.height, lanes[1]!.y]).toEqual([0, 190, 190]);
    expect(layout.laneBands!.map((band) => band.top)).toEqual([0, 190]);
    loops.growFirstLane(0, true);
    expect(lanes[0]!.height).toBe(190);
  });
});
