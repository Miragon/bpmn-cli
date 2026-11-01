import { describe, expect, it } from 'vitest';
import { DrawnDiagram } from '../../../src/drawing/runners/DrawnDiagram.js';
import { ShapePlacement } from '../../../src/drawing/runners/ShapePlacement.js';
import type { PlaceOperation } from '../../../src/operations/index.js';
import { Fixtures } from '../../support/Fixtures.js';

describe('ShapePlacement', () => {
  async function place(name: string, operation: Omit<PlaceOperation, 'op'>): Promise<{ diagram: DrawnDiagram; notes: string[] }> {
    const diagram = new DrawnDiagram(await Fixtures.read(name.includes('/') ? name : `drawing/runners/${name}.bpmn`));
    const notes: string[] = [];
    new ShapePlacement(diagram, { op: 'place', ...operation }, diagram.snapshot(), notes).run();
    return { diagram, notes };
  }

  const boxOf = (diagram: DrawnDiagram, id: string) => diagram.drawnShape(id).shape.bounds;

  it('puts a shape on the row of another, right of a third', async () => {
    const { diagram } = await place('branching', { ids: ['C'], rowOf: 'B', after: 'E' });

    expect(boxOf(diagram, 'C').center.y).toBe(boxOf(diagram, 'B').center.y);
    expect(boxOf(diagram, 'C').x).toBeGreaterThan(boxOf(diagram, 'E').right);
  });

  it('moves a group rigidly above an element', async () => {
    const before = new DrawnDiagram(await Fixtures.read('drawing/runners/branching.bpmn'));
    const { diagram } = await place('branching', { ids: ['B', 'E'], above: 'A' });

    expect(boxOf(diagram, 'B').bottom).toBeLessThanOrEqual(boxOf(diagram, 'A').y);
    expect(boxOf(diagram, 'E').x - boxOf(diagram, 'B').x).toBe(boxOf(before, 'E').x - boxOf(before, 'B').x);
  });

  it('puts a shape before another', async () => {
    const { diagram } = await place('branching', { ids: ['E2'], before: 'C' });

    expect(boxOf(diagram, 'E2').right).toBeLessThanOrEqual(boxOf(diagram, 'C').x);
  });

  it('notes a shape that is there already', async () => {
    const { notes } = await place('branching', { ids: ['A'], columnOf: 'A' });

    expect(notes).toEqual(['A is already there']);
  });

  it('moves a row reference that its neighbours were pushed onto along, so the row holds', async () => {
    const { diagram } = await place('models/gate/place-pinned-row.bpmn', { ids: ['M'], rowOf: 'J', after: 'X' });

    expect(boxOf(diagram, 'M').center.y).toBe(boxOf(diagram, 'J').center.y);
    expect(boxOf(diagram, 'B').right).toBeLessThanOrEqual(boxOf(diagram, 'J').x);
  });

  it('moves a shape off what it cannot push, along the axis the request leaves free, and says so', async () => {
    const { notes } = await place('layout/artifacts__03-data-objects.bpmn', { ids: ['Activity_Create'], below: 'Activity_Send' });

    expect(notes.join(' ')).toMatch(/^moved Activity_Create right a little to clear /);
  });

  it('refuses a move past its own frame as a reference', async () => {
    await expect(place('nested-sub-processes', { ids: ['Wrap'], after: 'Sub2' })).rejects.toMatchObject({ code: 'E_LEAVES_CONTAINER', message: 'Placing Wrap after Sub2 would move it out of its sub-process Sub2' });
  });

  it('refuses boundary events, pools, and shapes of different diagrams', async () => {
    await expect(place('sub-process', { ids: ['TB'], rowOf: 'A' })).rejects.toMatchObject({ code: 'E_WRONG_KIND', details: { hint: expect.stringContaining('--side top|bottom') } });
    await expect(place('lanes', { ids: ['Pool'], rowOf: 'A' })).rejects.toMatchObject({ code: 'E_WRONG_KIND' });
  });

  it('never pushes a reference or its frames away', async () => {
    await expect(place('two-pools', { ids: ['Need'], rowOf: 'Pick' })).rejects.toMatchObject({ code: 'E_NO_ROOM', details: { related: ['Pick', 'Supplier'] } });
  });

  it('hands a side to the boundary event', async () => {
    const { notes } = await place('boundary-path', { ids: ['TB'], side: 'bottom' });

    expect(notes).toEqual(['TB is already on the bottom border of A']);
  });
});
