import { describe, expect, it } from 'vitest';
import { RowGroups } from '../../../../src/drawing/full/lanes/RowGroups.js';
import { ScopeSketch } from '../../../support/ScopeSketch.js';

describe('RowGroups', () => {
  const parts = (): ScopeSketch => new ScopeSketch().node('task', 'a', 0, 0).node('task', 'b', 0, 0).node('task', 'c', 0, 0).node('task', 'd', 0, 0).flow('c', 'd');

  it('keeps the order without groups', () => {
    const sketch = parts();
    const roots = [sketch.at('a'), sketch.at('b')];

    expect(new RowGroups(sketch.layout().nodes, undefined).ordered(roots)).toEqual(roots);
  });

  it('moves the roots of one group up behind its first root, a connected part as one', () => {
    const sketch = parts();
    const { nodes } = sketch.layout();
    const groups = new Map([['a', ['G']], ['d', ['G']]]);

    const ordered = new RowGroups(nodes, groups).ordered([sketch.at('a'), sketch.at('b'), sketch.at('c')]);

    expect(ordered.map((node) => node.id)).toEqual(['a', 'c', 'b']);
  });

  it('nests inner groups behind their outer group', () => {
    const sketch = parts().boundary('event', 'a', 0);
    sketch.flow('event', 'b');
    const { nodes } = sketch.layout();
    const groups = new Map([['event', ['Outer', 'Inner']], ['c', ['Outer']]]);

    const ordered = new RowGroups(nodes, groups).ordered([sketch.at('c'), sketch.at('a')]);

    expect(ordered.map((node) => node.id)).toEqual(['c', 'a']);
  });
});
