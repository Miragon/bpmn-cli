import { describe, expect, it } from 'vitest';
import { DrawnDiagram } from '../../../../src/drawing/runners/DrawnDiagram.js';
import { BoundaryPlacement } from '../../../../src/drawing/runners/placement/BoundaryPlacement.js';
import { Fixtures } from '../../../support/Fixtures.js';

describe('BoundaryPlacement', () => {
  async function move(path: string, id: string, side: 'top' | 'bottom'): Promise<{ diagram: DrawnDiagram; notes: string[]; rerouted: string[] }> {
    const diagram = new DrawnDiagram(await Fixtures.read(path.includes('/') ? path : `drawing/runners/${path}.bpmn`));
    const notes: string[] = [];
    const rerouted = new BoundaryPlacement(diagram, diagram.snapshot(), notes).run(id, side);
    return { diagram, notes, rerouted };
  }

  const boxOf = (diagram: DrawnDiagram, id: string) => diagram.drawnShape(id).shape.bounds;

  it('moves an event to the other border; its path follows above the host', async () => {
    const { diagram, notes, rerouted } = await move('boundary-path', 'TB', 'top');

    expect(boxOf(diagram, 'TB').center.y).toBe(boxOf(diagram, 'A').y);
    expect(boxOf(diagram, 'R').bottom).toBeLessThanOrEqual(boxOf(diagram, 'A').y);
    expect(boxOf(diagram, 'TE').bottom).toBeLessThanOrEqual(boxOf(diagram, 'A').y);
    expect(notes.at(-1)).toBe('TB moved to the top border of A; its path followed (R, TE)');
    expect(rerouted).toHaveLength(1);
  });

  it('notes the border an event sits on already', async () => {
    const { notes } = await move('boundary-path', 'TB', 'bottom');

    expect(notes).toEqual(['TB is already on the bottom border of A']);
  });

  it('makes room above the host inside its lane, and the path stays in the lane', async () => {
    const { diagram, notes } = await move('boundary-lanes', 'Overdue', 'top');

    expect(notes[0]).toMatch(/^made \d+ px of room above Check in its lane Sales$/);
    expect(boxOf(diagram, 'Remind').isInside(boxOf(diagram, 'Sales'))).toBe(true);
  });

  it('grows a lane with a lane underneath at its bottom, and the path stays in it', async () => {
    const { diagram, notes } = await move('boundary-lanes-tight', 'Overdue', 'bottom');

    expect(notes[0]).toMatch(/^made \d+ px of room below Check in its lane Sales$/);
    expect(boxOf(diagram, 'Remind').y).toBeGreaterThanOrEqual(boxOf(diagram, 'Check').bottom);
    expect(boxOf(diagram, 'Billing').y).toBeGreaterThanOrEqual(boxOf(diagram, 'Sales').bottom);
  });

  it('refuses a full border instead of reaching over the corner', async () => {
    await expect(move('boundary-border-taken', 'Under', 'top')).rejects.toMatchObject({ code: 'E_NO_ROOM', details: { element: 'Under', related: ['A'] } });
  });

  it('refuses the way back to a border two other boundary events take', async () => {
    await expect(move('boundary-three-on-top', 'Event_Withdrawn', 'bottom')).rejects.toMatchObject({ code: 'E_NO_ROOM' });
  });

  it('refuses a shape that is no boundary event', async () => {
    await expect(move('boundary-path', 'A', 'top')).rejects.toMatchObject({ code: 'E_WRONG_KIND', message: '"A" is a task: side moves a boundary event to a border of its host' });
  });

  it('refuses an event whose host is not drawn', async () => {
    await expect(move('models/incremental/nohost.bpmn', 'B', 'top')).rejects.toMatchObject({ code: 'E_WRONG_KIND' });
  });
});
