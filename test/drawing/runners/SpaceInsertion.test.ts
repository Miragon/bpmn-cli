import { describe, expect, it } from 'vitest';
import { DrawnDiagram } from '../../../src/drawing/runners/DrawnDiagram.js';
import { SpaceInsertion } from '../../../src/drawing/runners/SpaceInsertion.js';
import type { SpaceOperation } from '../../../src/operations/index.js';
import { Fixtures } from '../../support/Fixtures.js';

describe('SpaceInsertion', () => {
  async function space(name: string, operation: Omit<SpaceOperation, 'op'>): Promise<{ diagram: DrawnDiagram; notes: string[]; rerouted: string[] }> {
    const diagram = new DrawnDiagram(await Fixtures.read(name.includes('/') ? name : `drawing/runners/${name}.bpmn`));
    const notes: string[] = [];
    const rerouted = new SpaceInsertion(diagram, { op: 'space', ...operation }, diagram.snapshot(), notes).run();
    return { diagram, notes, rerouted };
  }

  it('moves what lies right of the element by one column and stretches the flow across', async () => {
    const { diagram, notes, rerouted } = await space('branching', { after: 'A' });

    expect(diagram.drawnShape('G').shape.bounds.x - diagram.drawnShape('A').shape.bounds.right).toBeGreaterThan(160);
    expect(notes).toEqual([expect.stringMatching(/^inserted \d+ px \(1 column of \d+ px\) right of A$/)]);
    expect(rerouted).toEqual([]);
  });

  it('makes a lane taller from the inside, its pool with it', async () => {
    const before = new DrawnDiagram(await Fixtures.read('drawing/runners/lanes.bpmn'));
    const { diagram } = await space('lanes', { below: 'L1', by: 100 });

    expect(diagram.drawnShape('L1').shape.bounds.height).toBe(before.drawnShape('L1').shape.bounds.height + 100);
    expect(diagram.drawnShape('Pool').shape.bounds.height).toBe(before.drawnShape('Pool').shape.bounds.height + 100);
  });

  it('says how to ask for rows when a few pixels were probably not meant', async () => {
    const { notes } = await space('branching', { below: 'B', by: 5 });

    expect(notes[0]).toMatch(/^inserted 5 px below B; one row is \d+ px: --by 5row moves by 5 rows$/);
  });

  it('closes a negative amount of what is empty, and says how much of it was', async () => {
    const { notes } = await space('branching-spaced', { after: 'A', by: -1000 });

    expect(notes).toEqual([expect.stringMatching(/^closed \d+ px right of A \(of 1000 px asked for\): the rest is not empty$/)]);
  });

  it('shrinks a lane from its bottom, the pool with it', async () => {
    const before = new DrawnDiagram(await Fixtures.read('drawing/runners/lanes-grown.bpmn'));
    const { diagram, notes } = await space('lanes-grown', { below: 'L1', by: '-row' });

    expect(notes[0]).toMatch(/^closed \d+ px below L1$/);
    expect(diagram.drawnShape('Pool').shape.bounds.height).toBeLessThan(before.drawnShape('Pool').shape.bounds.height);
  });

  it('closes nothing where nothing is empty, and nothing beyond the last frame', async () => {
    const tight = await space('branching', { after: 'A', by: '-column' });
    const last = await space('sub-process', { after: 'Sub', by: '-column' });
    const end = await space('chain', { after: 'E', by: -10 });

    expect(tight.notes[0]).toMatch(/^nothing to close right of A: no empty space there \(the next element is \d+ px away, the drawing keeps \d+ px\)$/);
    expect(last.notes[0]).toMatch(/^nothing to close right of Sub/);
    expect(end.notes).toEqual(['nothing to close right of E: no empty space there']);
  });

  it('refuses a closing that adds a layout problem, and writes nothing', async () => {
    await expect(space('layout/lanes__complaint-t1.bpmn', { below: 'Activity_ReklamationErfassen', by: '-row' })).rejects.toMatchObject({ code: 'E_NO_ROOM', message: expect.stringContaining('would add frameOverlap') });
  });

  it('refuses a closing that something in the way blocks', async () => {
    await expect(space('layout/gallery__05-collab.bpmn', { below: 'Activity_ShipOrder', by: '-row' })).rejects.toMatchObject({ code: 'E_NO_ROOM', message: expect.stringContaining('would move something that is in the way') });
  });
});
