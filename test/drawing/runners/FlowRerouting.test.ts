import { describe, expect, it } from 'vitest';
import { DrawnDiagram } from '../../../src/drawing/runners/DrawnDiagram.js';
import { FlowRerouting } from '../../../src/drawing/runners/FlowRerouting.js';
import { Fixtures } from '../../support/Fixtures.js';

describe('FlowRerouting', () => {
  async function drawn(name: string): Promise<DrawnDiagram> {
    return new DrawnDiagram(await Fixtures.read(`drawing/runners/${name}.bpmn`));
  }

  it('leaves a flow that already takes the way asked for alone', async () => {
    const diagram = await drawn('chain');

    expect(new FlowRerouting(diagram, { op: 'route', id: 'F1' }).run()).toEqual([]);
  });

  it('routes a flow out of the side it is forced to and reports it', async () => {
    const diagram = await drawn('chain');

    expect(new FlowRerouting(diagram, { op: 'route', id: 'F2', exit: 'bottom', entry: 'bottom' }).run()).toEqual(['F2']);
    const { edge } = diagram.drawnEdge('F2');
    const { shape: task } = diagram.drawnShape('A');
    expect(edge.points[0]!.y).toBe(task.bounds.bottom);
  });

  it('refuses a side that would run the flow of a boundary event through its host', async () => {
    const diagram = await drawn('boundary-path');
    const flow = diagram.drawnEdge('flow_from2DaysToRemind');

    expect(flow.edge.sourceId).toBe('TB');
    expect(() => new FlowRerouting(diagram, { op: 'route', id: 'flow_from2DaysToRemind', exit: 'top' }).run()).toThrow(expect.objectContaining({ code: 'E_INVALID_VALUE', details: expect.objectContaining({ related: ['TB', 'A'] }) }));
  });

  it('refuses a flow one of whose ends lost its shape', async () => {
    const diagram = await drawn('chain');
    diagram.planes[0]!.shapes.delete('S');

    expect(() => new FlowRerouting(diagram, { op: 'route', id: 'F1' }).run()).toThrow(expect.objectContaining({ code: 'E_NO_SHAPE' }));
  });

  it('draws a flow that has no line yet', async () => {
    const diagram = await drawn('chain');
    diagram.planes[0]!.edges.delete('F2');

    expect(new FlowRerouting(diagram, { op: 'route', id: 'F2' }).run()).toEqual(['F2']);
    expect(diagram.drawnEdge('F2').edge.points.length).toBeGreaterThanOrEqual(2);
  });

  it('refuses a node, which is no flow', async () => {
    const diagram = await drawn('chain');

    expect(() => new FlowRerouting(diagram, { op: 'route', id: 'A' }).run()).toThrow(expect.objectContaining({ code: 'E_WRONG_KIND' }));
  });
});
