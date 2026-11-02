import { describe, expect, it } from 'vitest';
import { ScopeColumns } from '../../../../src/drawing/full/scopes/ScopeColumns.js';
import { ShapeSizes } from '../../../../src/drawing/plane/ShapeSizes.js';
import { ScopeSketch } from '../../../support/ScopeSketch.js';

describe('ScopeColumns', () => {
  const chain = (): ScopeSketch => new ScopeSketch().node('start', 's', 0, 0).node('task', 'a', 0, 0).node('end', 'e', 0, 0).flow('s', 'a').flow('a', 'e');

  it('puts a node one column right of its last source', () => {
    const sketch = chain();

    new ScopeColumns(sketch.layout()).assign(new Map());

    expect(['s', 'a', 'e'].map((id) => sketch.at(id).layer)).toEqual([0, 1, 2]);
  });

  it('moves what follows a shifted node, and answers the columns without the shift', () => {
    const sketch = chain();

    const natural = new ScopeColumns(sketch.layout()).assign(new Map([[sketch.at('a'), 2]]));

    expect(sketch.at('e').layer).toBe(4);
    expect(natural.get(sketch.at('e'))).toBe(2);
  });

  it('widens a gap for a flow label and for two labels on one side', () => {
    const sketch = new ScopeSketch().node('gateway', 'g', 0, 0, { name: 'A gateway with quite a long name in it', layer: 0 }).node('task', 'a', 0, 0, { layer: 1 }).flow('g', 'a', { name: 'a flow with a name that wraps over more than a single line of text' });
    const events = new ScopeSketch().node('event', 'x', 0, 0, { name: 'an event with a rather long label below', layer: 0 }).node('event', 'y', 0, 0, { name: 'another event with a long label below', layer: 1 });

    expect(new ScopeColumns(sketch.layout()).gaps([50, 100])[0]).toBeGreaterThan(ShapeSizes.GAPS.hGap);
    expect(new ScopeColumns(events.layout()).gaps([10, 10])[0]).toBeGreaterThan(ShapeSizes.GAPS.hGap);
  });
});
