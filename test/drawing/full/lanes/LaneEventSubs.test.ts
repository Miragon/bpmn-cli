import { describe, expect, it } from 'vitest';
import { LaneEventSubs } from '../../../../src/drawing/full/lanes/LaneEventSubs.js';
import type { LaneBand } from '../../../../src/drawing/full/lanes/LaneTree.js';
import { ScopeSketch } from '../../../support/ScopeSketch.js';

describe('LaneEventSubs', () => {
  function laned() {
    const sketch = new ScopeSketch().node('task', 'a', 0, 30).node('task', 'b', 0, 230);
    const layout = sketch.layout();
    const sub = new ScopeSketch().node('eventSubProcess', 'sub', 0, 0, { width: 300, height: 150 }).at('sub');
    const lastSub = new ScopeSketch().node('eventSubProcess', 'lastSub', 0, 0, { width: 300, height: 150 }).at('lastSub');
    layout.eventSubs.push(sub, lastSub);
    const lanes: LaneBand[] = [
      { el: layout.el, id: 'one', nodes: [sketch.at('a')], subs: [sub], children: [], y: 0, height: 200 },
      { el: layout.el, id: 'two', nodes: [sketch.at('b')], subs: [lastSub], children: [], y: 200, height: 140 },
    ];
    return { sketch, layout, lanes, sub, lastSub };
  }

  it('stacks an event sub-process in its lane, the lane grows, the lanes below move down', () => {
    const { sketch, layout, lanes, sub } = laned();

    new LaneEventSubs(layout, lanes).place();

    expect(sub.box.y).toBeGreaterThan(sketch.at('a').box.bottom);
    expect(sub.box.bottom).toBeLessThanOrEqual(lanes[0]!.y + lanes[0]!.height);
    expect(sketch.at('b').box.y).toBeGreaterThan(sub.box.bottom);
  });

  it('puts the event sub-process of the last lane below everything and answers the lowest edge', () => {
    const { layout, lanes, lastSub } = laned();

    expect(new LaneEventSubs(layout, lanes).place()).toBe(lastSub.box.bottom);
  });
});
