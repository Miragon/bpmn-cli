import { describe, expect, it } from 'vitest';
import { BandReordering } from '../../../src/drawing/runners/BandReordering.js';
import { DrawnDiagram } from '../../../src/drawing/runners/DrawnDiagram.js';
import type { OrderOperation } from '../../../src/operations/index.js';
import { Fixtures } from '../../support/Fixtures.js';

describe('BandReordering', () => {
  async function order(name: string, operation: Omit<OrderOperation, 'op'>): Promise<{ diagram: DrawnDiagram; notes: string[]; rerouted: string[] }> {
    const diagram = new DrawnDiagram(await Fixtures.read(`drawing/runners/${name}.bpmn`));
    const notes: string[] = [];
    const rerouted = new BandReordering(diagram, { op: 'order', ...operation }, diagram.snapshot(), notes).run();
    return { diagram, notes, rerouted };
  }

  const boxOf = (diagram: DrawnDiagram, id: string) => diagram.drawnShape(id).shape.bounds;

  it('stacks lanes in their model order and carries their content along', async () => {
    const { diagram, rerouted } = await order('lanes-reordered', { id: 'Pool', lanes: ['L2', 'L1'] });

    expect(boxOf(diagram, 'L2').y).toBe(boxOf(diagram, 'Pool').y);
    expect(boxOf(diagram, 'L1').y).toBe(boxOf(diagram, 'L2').bottom);
    expect(boxOf(diagram, 'A').isInside(boxOf(diagram, 'L1'))).toBe(true);
    expect(rerouted).toEqual([]);
  });

  it('orders nested lanes within their parent lane', async () => {
    const { diagram } = await order('lanes-nested-reordered', { id: 'L1', lanes: ['L1b', 'L1a'] });

    expect(boxOf(diagram, 'L1b').y).toBeLessThan(boxOf(diagram, 'L1a').y);
    expect(boxOf(diagram, 'A').isInside(boxOf(diagram, 'L1a'))).toBe(true);
    expect(boxOf(diagram, 'B').isInside(boxOf(diagram, 'L1b'))).toBe(true);
  });

  it('grows a lane whose member hung out at its bottom, so nothing lands in the lane below', async () => {
    const { diagram } = await order('lanes-overhang', { id: 'Pool', lanes: ['Low', 'Top'] });

    expect(boxOf(diagram, 'A').bottom).toBeLessThanOrEqual(boxOf(diagram, 'Top').bottom);
    expect(boxOf(diagram, 'Low').bottom).toBe(boxOf(diagram, 'Top').y);
  });

  it('leaves lanes alone that are in order or not drawn', async () => {
    const ordered = await order('lanes', { id: 'Pool', lanes: ['L1', 'L2'] });
    const undrawn = await order('branching', { id: 'P', lanes: ['L1'] });

    expect(ordered.rerouted).toEqual([]);
    expect(undrawn.notes).toEqual(['the lanes are not drawn: nothing to reorder in the diagram']);
  });

  it('stacks pools in the order of the collaboration, keeping the gaps between them', async () => {
    const before = new DrawnDiagram(await Fixtures.read('drawing/runners/two-pools.bpmn'));
    const { diagram } = await order('two-pools-reordered', { id: 'C1', pools: ['Supplier', 'Customer'] });

    const gap = boxOf(before, 'Supplier').y - boxOf(before, 'Customer').bottom;
    expect(boxOf(diagram, 'Supplier').y).toBe(boxOf(before, 'Customer').y);
    expect(boxOf(diagram, 'Customer').y).toBe(boxOf(diagram, 'Supplier').bottom + gap);
  });

  it('keeps pools that share rows where they are, and says so', async () => {
    const { notes } = await order('pools-side-by-side-reordered', { id: 'Collab', pools: ['Below', 'Right', 'Left'] });

    expect(notes[0]).toMatch(/^the pools are not stacked top to bottom/);
  });

  it('leaves pools alone that are in order', async () => {
    const before = new DrawnDiagram(await Fixtures.read('drawing/runners/two-pools.bpmn'));
    const { diagram, rerouted } = await order('two-pools', { id: 'C1', pools: ['Customer', 'Supplier'] });

    expect(boxOf(diagram, 'Supplier')).toEqual(boxOf(before, 'Supplier'));
    expect(rerouted).toEqual([]);
  });

  it('takes a shape without lane along with the band it stands in', async () => {
    const before = new DrawnDiagram(await Fixtures.read('drawing/runners/lanes-overhang.bpmn'));
    const { diagram } = await order('lanes-overhang', { id: 'Pool', lanes: ['Low', 'Top'] });

    expect(boxOf(diagram, 'Free').y - boxOf(diagram, 'Top').y).toBe(boxOf(before, 'Free').y - boxOf(before, 'Top').y);
  });

  it('takes a sub-process without lane along with the band it stands in, content and all', async () => {
    const { diagram } = await order('lanes-sub-without-lane', { id: 'Pool', lanes: ['Low', 'Top'] });

    expect(boxOf(diagram, 'Free').isInside(boxOf(diagram, 'Top'))).toBe(true);
    expect(boxOf(diagram, 'Inner').isInside(boxOf(diagram, 'Free'))).toBe(true);
  });

  it('says when fewer than two pools are drawn', async () => {
    const { notes } = await order('lanes', { id: 'collaboration_p', pools: ['Pool'] });

    expect(notes).toEqual(['fewer than two pools are drawn: nothing to reorder in the diagram']);
  });
});
