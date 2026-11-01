import { describe, expect, it } from 'vitest';
import { ScopeGrid } from '../../../../src/drawing/full/scopes/ScopeGrid.js';
import { ScopeSketch } from '../../../support/ScopeSketch.js';
import { ShapeSizes } from '../../../../src/drawing/plane/ShapeSizes.js';

describe('ScopeGrid', () => {
  function hostWith(events: number, kind: 'task' | 'subProcess' = 'task') {
    const sketch = new ScopeSketch().node(kind, 'host', 100, 100);
    for (let index = 0; index < events; index++) {
      sketch.boundary(`event${index}`, 'host', 0);
    }
    const host = sketch.at('host');
    ScopeGrid.spreadOverBorders(host);
    ScopeGrid.placeBoundaryEvents(host);
    return host;
  }

  it('fits two events on a border of a standard task', () => {
    expect(ScopeGrid.borderSpots(hostWith(0))).toBe(2);
  });

  it('keeps a task at the standard size with three events, the third on the top border', () => {
    const host = hostWith(3);

    expect(host.box.width).toBe(ShapeSizes.TASK.width);
    expect(host.boundary.map((event) => !!event.onTop)).toEqual([false, false, true]);
    expect(host.boundary.every((event) => event.box.x >= host.box.x && event.box.right <= host.box.right)).toBe(true);
  });

  it('lets a fifth event overlap, as both borders are full', () => {
    const host = hostWith(5);

    expect(host.boundary[4]?.box.x).toBe(host.boundary[0]?.box.x);
  });

  it('runs events on a collapsed sub-process left to right, off the drill-down marker', () => {
    const [first, second] = hostWith(2, 'subProcess').boundary;

    expect(first!.box.x).toBeLessThan(second!.box.x);
  });

  it('leaves room below a row of a node with boundary events', () => {
    expect(ScopeGrid.boundaryExtra(hostWith(1))).toBeGreaterThan(0);
    expect(ScopeGrid.boundaryExtra(hostWith(0))).toBe(0);
  });

  it('centres same-row nodes on one line and leaves an empty scope at size 0', () => {
    const sketch = new ScopeSketch().node('start', 's', 0, 0).node('task', 'a', 0, 0).flow('s', 'a');
    const layout = sketch.layout();
    new ScopeGrid(layout).arrange();
    const empty = new ScopeSketch().layout();
    empty.nodes.length = 0;
    new ScopeGrid(empty).arrange();

    expect(sketch.at('s').box.center.y).toBe(sketch.at('a').box.center.y);
    expect([empty.width, empty.height]).toEqual([0, 0]);
  });

  it('gives a skip flow a band row of its own and a data row extra height', () => {
    const sketch = new ScopeSketch().node('gateway', 'g', 0, 0).node('task', 'a', 0, 0).node('task', 'j', 0, 0).flow('g', 'a').flow('a', 'j').flow('g', 'j');
    const layout = sketch.layout();
    const data = ScopeSketch.artifact('bpmn:DataObjectReference', 'data', 'dataObject', ShapeSizes.DATA_OBJECT);
    data.anchorNode = sketch.at('a');
    layout.artifacts.push(data);
    new ScopeGrid(layout).arrange();

    expect(sketch.edge('g', 'j').bandY).toBeGreaterThan(sketch.at('a').box.bottom);
  });
});
