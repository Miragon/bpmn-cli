import { describe, expect, it } from 'vitest';
import { DrawnDiagram } from '../../../src/drawing/runners/DrawnDiagram.js';
import { LabelPlacement } from '../../../src/drawing/runners/LabelPlacement.js';
import type { LabelOperation } from '../../../src/operations/index.js';
import { Fixtures } from '../../support/Fixtures.js';

describe('LabelPlacement', () => {
  async function drawn(name: string): Promise<DrawnDiagram> {
    return new DrawnDiagram(await Fixtures.read(`drawing/runners/${name}.bpmn`));
  }

  function place(diagram: DrawnDiagram, operation: Omit<LabelOperation, 'op'>, notes: string[] = []) {
    return new LabelPlacement(diagram, { op: 'label', ...operation }, diagram.snapshot(), notes).run();
  }

  it('puts the label of a gateway below it', async () => {
    const diagram = await drawn('branching');

    expect(place(diagram, { id: 'G', side: 'below' }).labels).toEqual(['G']);
    const { shape } = diagram.drawnShape('G');
    expect(shape.label!.y).toBeGreaterThanOrEqual(shape.bounds.bottom);
  });

  it('reports no label when the label is on that side already', async () => {
    const diagram = await drawn('branching');
    place(diagram, { id: 'G', side: 'below' });

    expect(place(diagram, { id: 'G', side: 'below' }).labels).toEqual([]);
  });

  it('puts the label of a flow above its longest horizontal segment', async () => {
    const diagram = await drawn('branching');

    place(diagram, { id: 'F_yes', side: 'above' });

    const { edge } = diagram.drawnEdge('F_yes');
    expect(edge.label!.bottom).toBeLessThanOrEqual(Math.max(...edge.points.map(({ y }) => y)));
  });

  it('refuses a side a flow has no segment for', async () => {
    const diagram = await drawn('branching');

    expect(() => place(diagram, { id: 'F_yes', side: 'right' })).toThrow(expect.objectContaining({ code: 'E_INVALID_VALUE' }));
  });

  it('refuses a task, which carries its name inside, and an unnamed event', async () => {
    const tasks = await drawn('branching');
    const unnamed = await drawn('sub-process');

    expect(() => place(tasks, { id: 'A', side: 'below' })).toThrow(expect.objectContaining({ code: 'E_WRONG_KIND' }));
    expect(() => place(unnamed, { id: 'SS', side: 'above' })).toThrow(expect.objectContaining({ code: 'E_NO_LABEL' }));
  });

  it('makes room below the title for a label above a shape at the top of a sub-process', async () => {
    const diagram = await drawn('sub-process');
    const notes: string[] = [];
    const { shape } = diagram.drawnShape('SE');
    const { shape: frame } = diagram.drawnShape('Sub');
    shape.bounds.y = frame.bounds.y + 10;

    place(diagram, { id: 'SE', side: 'above' }, notes);

    expect(notes.join(' ')).toMatch(/made \d+ px of room above SE in its sub-process Sub/);
  });
});
