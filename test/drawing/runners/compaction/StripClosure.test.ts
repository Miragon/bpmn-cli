import { describe, expect, it } from 'vitest';
import { StripClosure } from '../../../../src/drawing/runners/compaction/StripClosure.js';
import { DrawnDiagram } from '../../../../src/drawing/runners/DrawnDiagram.js';
import { Fixtures } from '../../../support/Fixtures.js';

describe('StripClosure', () => {
  async function drawn(name: string): Promise<{ closure: StripClosure; diagram: DrawnDiagram }> {
    const diagram = new DrawnDiagram(await Fixtures.read(`drawing/runners/${name}.bpmn`));
    return { closure: new StripClosure(diagram.drawing(diagram.planes[0]!)), diagram };
  }

  it('closes an empty column: what lies beyond moves back', async () => {
    const { closure, diagram } = await drawn('branching-spaced');
    const { bounds: task } = diagram.drawnShape('A').shape;
    const gateway = diagram.drawnShape('G').shape.bounds;
    const { x } = gateway;

    const result = closure.close('x', { from: task.right, to: x, keep: 60 });

    expect(result?.moved.has('G')).toBe(true);
    expect(diagram.drawnShape('G').shape.bounds.x).toBe(task.right + 60);
  });

  it('squeezes the bends and the label of a message flow into what a closed row keeps', async () => {
    const { closure, diagram } = await drawn('message-flow-bent');

    closure.close('y', { from: 210, to: 500, keep: 30 }, diagram.drawnShape('Top').shape.bounds);

    const { points, label } = diagram.drawnEdge('M').edge;
    expect(points[1]!.y).toBe(224);
    expect(points[2]!.y).toBe(224);
    expect(label!.y).toBe(214);
  });

  it('squeezes only the bends inside the band it closes in', async () => {
    const { closure, diagram } = await drawn('message-flow-bent');

    closure.close('x', { from: 300, to: 600, keep: 60 }, diagram.drawnShape('Top').shape.bounds);

    const { points, label } = diagram.drawnEdge('M').edge;
    expect(points[2]!.x).toBe(330);
    expect(points[3]!.x).toBe(450);
    expect(label!.x).toBeLessThan(310);
  });

  it('squeezes across the whole plane without a band', async () => {
    const { closure, diagram } = await drawn('message-flow-bent');

    closure.close('y', { from: 210, to: 500, keep: 30 });

    expect(diagram.drawnEdge('M').edge.points[1]!.y).toBe(224);
  });

  it('answers nothing when the strip holds something', async () => {
    const { closure, diagram } = await drawn('chain');
    const { bounds } = diagram.drawnShape('A').shape;

    expect(closure.close('x', { from: bounds.x - 10, to: bounds.right + 10, keep: 0 })).toBeUndefined();
  });
});
