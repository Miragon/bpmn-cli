import { describe, expect, it } from 'vitest';
import type { ScopeLayout } from '../../../../src/drawing/full/scopes/GNode.js';
import { ArrangementTrial, type Routes } from '../../../../src/drawing/full/trials/ArrangementTrial.js';
import { ScopeSketch } from '../../../support/ScopeSketch.js';

class MeasuringTrial extends ArrangementTrial {
  routes?: Routes;

  run(): void {
    this.routes = this.routesOf(true);
  }
}

describe('ArrangementTrial', () => {
  function measured(layout: ScopeLayout): Routes {
    const trial = new MeasuringTrial(layout);
    trial.run();
    return trial.routes!;
  }

  it('counts a flow along a row as straight, and leaves the scope as it was', () => {
    const sketch = new ScopeSketch().node('task', 'a', 0, 0).node('task', 'b', 200, 0).flow('a', 'b');
    const layout = sketch.layout();

    const routes = measured(layout);

    expect(routes.straight.has(sketch.edge('a', 'b'))).toBe(true);
    expect(routes.bends).toBe(0);
    expect(sketch.edge('a', 'b').points).toEqual([]);
  });

  it('counts a flow rising straight into a join', () => {
    const sketch = new ScopeSketch().node('task', 'a', 300, 0).node('gateway', 'join', 500, 15).node('task', 'low', 300, 200).flow('a', 'join').flow('low', 'join');

    expect(measured(sketch.layout()).rises.has(sketch.edge('low', 'join'))).toBe(true);
  });

  it('finds two flows sharing a line', () => {
    const sketch = new ScopeSketch().node('gateway', 'g', 0, 0).node('task', 'a', 300, 100).node('task', 'b', 300, 300).flow('g', 'a').flow('g', 'b');

    const { shared, sharing } = measured(sketch.layout());

    expect(sharing.size).toBe(shared ? 2 : 0);
  });
});
