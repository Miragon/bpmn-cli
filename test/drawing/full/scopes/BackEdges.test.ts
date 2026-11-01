import { describe, expect, it } from 'vitest';
import { BackEdges } from '../../../../src/drawing/full/scopes/BackEdges.js';
import { ScopeSketch } from '../../../support/ScopeSketch.js';

describe('BackEdges', () => {
  function backOf(sketch: ScopeSketch): string[] {
    const layout = sketch.layout();
    new BackEdges(layout).mark();
    return layout.edges.filter((edge) => edge.back).map((edge) => edge.id);
  }

  it('cuts a loop at the flow back to its shallowest node', () => {
    const sketch = new ScopeSketch().node('start', 's', 0, 0).node('task', 'a', 0, 0).node('task', 'b', 0, 0).flow('s', 'a').flow('a', 'b').flow('b', 'a');

    expect(backOf(sketch)).toEqual(['b_a']);
  });

  it('marks no flow in a graph without a cycle', () => {
    expect(backOf(new ScopeSketch().node('start', 's', 0, 0).node('end', 'e', 0, 0).flow('s', 'e'))).toEqual([]);
  });

  it('cuts a loop nothing leads into, and a loop closed by a boundary event', () => {
    const sketch = new ScopeSketch().node('task', 'a', 0, 0).boundary('late', 'a', 0).node('task', 'b', 0, 0).flow('late', 'b').flow('b', 'a').node('task', 'c', 0, 0).node('task', 'd', 0, 0).flow('c', 'd').flow('d', 'c');

    expect(backOf(sketch)).toHaveLength(2);
  });
});
