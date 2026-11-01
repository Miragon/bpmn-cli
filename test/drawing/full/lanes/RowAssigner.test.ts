import { describe, expect, it } from 'vitest';
import { RowAssigner } from '../../../../src/drawing/full/lanes/RowAssigner.js';
import type { GNode } from '../../../../src/drawing/full/scopes/GNode.js';
import { ScopeColumns } from '../../../../src/drawing/full/scopes/ScopeColumns.js';
import { ScopeGraph } from '../../../../src/drawing/full/scopes/ScopeGraph.js';
import { ScopeSketch } from '../../../support/ScopeSketch.js';
import { Fixtures } from '../../../support/Fixtures.js';

describe('RowAssigner', () => {
  function assigned(sketch: ScopeSketch): void {
    const layout = sketch.layout();
    new RowAssigner(layout, undefined, new ScopeColumns(layout).assign(new Map())).assign();
  }

  it('keeps the path reaching farthest on row 0, the other branch below', () => {
    const sketch = new ScopeSketch().node('gateway', 'g', 0, 0).node('end', 'short', 0, 0).node('task', 'a', 0, 0).node('end', 'far', 0, 0).flow('g', 'short').flow('g', 'a').flow('a', 'far');

    assigned(sketch);

    expect(sketch.at('far').row).toBe(0);
    expect(sketch.at('short').row).toBe(1);
  });

  it('prefers a way on over a way that only loops back', () => {
    const sketch = new ScopeSketch().node('start', 's', 0, 0).node('gateway', 'g', 0, 0).node('task', 'loop', 0, 0).node('end', 'e', 0, 0).flow('s', 'g').flow('g', 'loop').flow('g', 'e').flow('loop', 's', { back: true });

    assigned(sketch);

    expect(sketch.at('e').row).toBe(0);
  });

  it('gives parts without a connection rows of their own', () => {
    const sketch = new ScopeSketch().node('task', 'a', 0, 0).node('task', 'b', 0, 0);

    assigned(sketch);

    expect(sketch.at('a').row).not.toBe(sketch.at('b').row);
  });

  it('leads a branch of a boundary event on the top border above its host, and one on the bottom border below', async () => {
    const document = await Fixtures.read('layout/artifacts__10-three-boundaries.bpmn');
    const { layout, byId } = new ScopeGraph(document.tree.processes()[0]!, () => {});
    new RowAssigner(layout, undefined, new ScopeColumns(layout).assign(new Map())).assign();
    const row = (id: string): number => (byId.get(id) as GNode).row;

    expect(row('Activity_Cancel')).toBeLessThan(row('Activity_Approve'));
    expect(row('Activity_Remind')).toBeGreaterThan(row('Activity_Approve'));
    expect(Math.min(...layout.nodes.map((node) => node.row))).toBe(0);
  });

  it('takes a compensation handler below its host', async () => {
    const document = await Fixtures.read('layout/artifacts__09-compensation.bpmn');
    const { layout } = new ScopeGraph(document.tree.processes()[0]!, () => {});
    new RowAssigner(layout, undefined, new ScopeColumns(layout).assign(new Map())).assign();
    const { event, handler } = layout.compensations[0]!;

    expect(handler.row).toBeGreaterThan(event.host!.row);
  });
});
