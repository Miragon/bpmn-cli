import { describe, expect, it } from 'vitest';
import { DrawnDiagram } from '../../../../src/drawing/runners/DrawnDiagram.js';
import { RoomTrial, type RoomRequest } from '../../../../src/drawing/runners/placement/RoomTrial.js';
import { Fixtures } from '../../../support/Fixtures.js';

describe('RoomTrial', () => {
  async function trial(name: string, moved: string[], references: string[], given: Partial<RoomRequest> = {}): Promise<{ diagram: DrawnDiagram; trial: RoomTrial; request: RoomRequest }> {
    const diagram = new DrawnDiagram(await Fixtures.read(`drawing/runners/${name}.bpmn`));
    const plane = diagram.planes[0]!;
    const request: RoomRequest = { moved: moved.map((id) => diagram.drawnShape(id).shape), references: references.map((id) => diagram.drawnShape(id).shape), before: diagram.snapshot(), target: 'there', holds: () => true, lock: ['y'], ...given };
    return { diagram, trial: new RoomTrial(plane, diagram.drawing(plane), request), request };
  }

  it('counts the boundary events of a moved shape as moved, and keeps references apart', async () => {
    const { trial: room } = await trial('sub-process', ['Sub'], ['Sub', 'A']);

    expect(room.movedIds).toEqual(['Sub', 'TB']);
    expect(room.referenceIds).toEqual(['A']);
  });

  it('passes when nothing is in the way', async () => {
    const { trial: room } = await trial('branching', ['E2'], ['E']);

    expect(room.attempt(room.referenceIds)).toMatchObject({ ok: true, notes: [], swallowed: [], displaced: [], collided: [], strayed: [] });
  });

  it('fails when the request no longer holds', async () => {
    const { trial: room } = await trial('branching', ['E2'], [], { holds: () => false });

    expect(room.attempt([]).ok).toBe(false);
  });

  it('reports a frame the reference left when something pushed it', async () => {
    const { diagram, trial: room } = await trial('two-pools', ['Need'], ['Pick']);
    const supplier = diagram.drawnShape('Supplier').shape;
    supplier.bounds.y += 100;

    expect(room.attempt(room.referenceIds).displaced).toEqual([{ reference: diagram.drawnShape('Pick').shape, frame: supplier }]);
  });

  it('reports a sub-process that grew over a reference', async () => {
    const { diagram, trial: room } = await trial('sub-process', ['ST'], ['E2']);
    const frame = diagram.drawnShape('Sub').shape;
    frame.bounds = diagram.drawnShape('E2').shape.bounds.grow(20);

    expect(room.attempt(room.referenceIds).swallowed).toEqual([diagram.drawnShape('E2').shape]);
  });

  it('reports shapes that strayed out of their frame', async () => {
    const { diagram, trial: room } = await trial('lanes', ['A'], []);
    const stray = diagram.drawnShape('C').shape;
    stray.bounds.y += 1000;

    expect(room.attempt([]).strayed).toEqual(expect.arrayContaining([{ shape: stray, frame: diagram.drawnShape('L1').shape }]));
  });

  it('grows the frame of a shape whose label reaches past its bottom and right', async () => {
    const { diagram, trial: room } = await trial('lanes', ['E2'], []);
    const { shape } = diagram.drawnShape('E2');
    const frame = diagram.drawnShape('L1').shape;
    const { bottom, right } = frame.bounds;
    shape.label = shape.bounds.copy();
    shape.label.x = right - 5;
    shape.label.y = bottom - 5;

    room.attempt([]);

    expect(frame.bounds.bottom).toBeGreaterThan(bottom);
    expect(frame.bounds.right).toBeGreaterThan(right);
  });
});
