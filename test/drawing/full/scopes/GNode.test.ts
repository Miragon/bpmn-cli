import { describe, expect, it } from 'vitest';
import { ScopeSketch } from '../../../support/ScopeSketch.js';

describe('GNode', () => {
  it('collects its own flows and those of its boundary events', () => {
    const scope = new ScopeSketch().node('task', 'a', 0, 0).boundary('event', 'a', 20).node('task', 'b', 200, 0).node('task', 'c', 200, 200).flow('a', 'b').flow('event', 'c');

    expect(scope.at('a').outgoing.map(({ id }) => id)).toEqual(['a_b', 'event_c']);
  });

  it('tells events from other nodes', () => {
    const scope = new ScopeSketch().node('start', 's', 0, 0).node('end', 'e', 100, 0).node('event', 'i', 200, 0).node('task', 't', 300, 0);

    expect(['s', 'e', 'i', 't'].map((id) => scope.at(id).isEvent)).toEqual([true, true, true, false]);
  });

  it('keeps the boundary events of a collapsed sub-process left, not of an expanded one', () => {
    const scope = new ScopeSketch().node('subProcess', 'collapsed', 0, 0).node('subProcess', 'expanded', 200, 0);
    scope.at('expanded').child = ScopeSketch.emptyLayout(scope.at('expanded').el, [], []);

    expect(scope.at('collapsed').keepsBoundaryLeft).toBe(true);
    expect(scope.at('expanded').keepsBoundaryLeft).toBe(false);
    expect(scope.at('expanded').topX).toBe(225);
  });

  it('offers the centre of the bottom first, and the part free of boundary events', () => {
    const plain = new ScopeSketch().node('task', 'a', 0, 0).node('gateway', 'g', 200, 0);
    const hosted = new ScopeSketch().node('task', 'a', 0, 0).boundary('event', 'a', 60).node('subProcess', 'sub', 200, 0).boundary('held', 'sub', 210);

    expect(plain.at('a').bottomCandidates()).toEqual([50, 25, 75]);
    expect(plain.at('g').bottomCandidates()).toEqual([225]);
    expect(hosted.at('a').bottomCandidates()).toEqual([20, 8]);
    expect(hosted.at('sub').bottomCandidates()).toEqual([280, 292]);
  });

  it('rises beside the line it drops on', () => {
    const scope = new ScopeSketch().node('task', 'a', 0, 0).node('task', 'below', 200, 200).flow('a', 'below');

    expect(scope.at('a').riseSlots()).toEqual([25, 75]);
    expect(scope.at('a').riseX()).toBe(25);
  });

  it('counts the flows that rise into it, for a gateway only as a join', () => {
    const scope = new ScopeSketch().node('gateway', 'join', 200, 0).node('task', 'x', 0, 200).node('task', 'y', 0, 400).flow('x', 'join').flow('y', 'join');
    const single = new ScopeSketch().node('gateway', 'g', 200, 0).node('task', 'x', 0, 200).flow('x', 'g');

    expect(scope.at('join').risesInto()).toHaveLength(2);
    expect(scope.at('join').entriesFromBelow()).toHaveLength(2);
    expect(single.at('g').entriesFromBelow()).toHaveLength(0);
  });

  it('moves its boundary events along', () => {
    const scope = new ScopeSketch().node('task', 'a', 0, 0).boundary('event', 'a', 20);

    scope.at('a').shift(10, 5);

    expect([scope.at('a').box.x, scope.at('event').box.y]).toEqual([10, 67]);
  });
});
