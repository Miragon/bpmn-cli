import { describe, expect, it } from 'vitest';
import { DiagramCompaction } from '../../../src/drawing/runners/DiagramCompaction.js';
import { DrawnDiagram } from '../../../src/drawing/runners/DrawnDiagram.js';
import type { CompactOperation } from '../../../src/operations/index.js';
import { Fixtures } from '../../support/Fixtures.js';

describe('DiagramCompaction', () => {
  async function compact(name: string, ids?: string[]): Promise<{ diagram: DrawnDiagram; notes: string[] }> {
    const diagram = new DrawnDiagram(await Fixtures.read(`drawing/runners/${name}.bpmn`));
    const notes: string[] = [];
    const operation: CompactOperation = { op: 'compact', ...(ids ? { ids } : {}) };
    new DiagramCompaction(diagram, operation, diagram.snapshot(), notes).run();
    return { diagram, notes };
  }

  it('shrinks a lane that grew empty rows; its lane below and its pool follow', async () => {
    const { diagram, notes } = await compact('lanes-grown');

    const lane = diagram.drawnShape('L1').shape.bounds;
    expect(diagram.drawnShape('L2').shape.bounds.y).toBe(lane.bottom);
    expect(notes.join(' ')).toMatch(/^closed 1 empty row \(\d+ px\)$/);
  });

  it('compacts a process without pools in one column, keeping the order', async () => {
    const { diagram, notes } = await compact('branching-spaced');

    expect(diagram.drawnShape('G').shape.bounds.x).toBeGreaterThan(diagram.drawnShape('A').shape.bounds.right);
    expect(notes).toEqual([expect.stringMatching(/^closed 1 empty column \(\d+ px\)$/)]);
  });

  it('shrinks only the sub-process it names', async () => {
    const before = await compact('sub-process-spaced', []);
    const { diagram } = await compact('sub-process-spaced', ['Sub']);

    expect(diagram.drawnShape('E').shape.bounds).toEqual(before.diagram.drawnShape('E').shape.bounds);
    expect(diagram.drawnShape('Sub').shape.bounds.width).toBeLessThan(before.diagram.drawnShape('Sub').shape.bounds.width);
  });

  it('takes the process of a plane without pool as the whole plane', async () => {
    const { notes } = await compact('branching-spaced', ['P']);

    expect(notes.join(' ')).toMatch(/closed 1 empty column/);
  });

  it('says when nothing is left to close', async () => {
    const { notes } = await compact('branching');

    expect(notes).toEqual(['nothing to compact: no empty row or column to close']);
  });

  it('leaves a gap open that closing would turn into a layout problem, and names the problem', async () => {
    const { diagram, notes } = await compact('pools-side-by-side');

    expect(notes.join(' ')).toMatch(/left \d+ gaps? open: closing (it|them) would add/);
    expect(diagram.drawnShape('Below').shape.bounds.y).toBeGreaterThanOrEqual(diagram.drawnShape('Right').shape.bounds.bottom);
  });

  it('refuses a task, which is no frame, and a file without diagram', async () => {
    const bare = new DrawnDiagram(await Fixtures.read('drawing/idless.bpmn'));

    await expect(compact('lanes', ['A'])).rejects.toMatchObject({ code: 'E_WRONG_KIND' });
    expect(() => new DiagramCompaction(bare, { op: 'compact' }, bare.snapshot(), []).run()).toThrow(expect.objectContaining({ code: 'E_NO_DIAGRAM' }));
  });
});
