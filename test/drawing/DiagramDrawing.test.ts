import { describe, expect, it } from 'vitest';
import { DiagramDrawing } from '../../src/drawing/DiagramDrawing.js';
import { DrawingSnapshot } from '../../src/drawing/DrawingSnapshot.js';
import { BpmnError, ChangeSet } from '../support/ModelValues.js';
import { Fixtures } from '../support/Fixtures.js';

describe('DiagramDrawing', () => {
  async function update(path: string, changes: ChangeSet, operations: Parameters<DiagramDrawing['update']>[2]) {
    const document = await Fixtures.read(path);
    return new DiagramDrawing(document).update(DrawingSnapshot.of(document), changes, operations);
  }

  const changed = (): ChangeSet => new ChangeSet().change({ id: 'A', kind: 'task' });

  it('draws an empty plane in full', async () => {
    await expect(update('drawing/empty-diagram.bpmn', new ChangeSet(), [])).rejects.toThrow(/FullLayout is not ported yet/);
  });

  it('draws in full on a layout operation, however drawn the plane', async () => {
    await expect(update('models/incremental/boundary.bpmn', changed(), [{ op: 'layout' }])).rejects.toThrow(/FullLayout is not ported yet/);
  });

  it('refuses with E_LAYOUT_INCREMENTAL and the hint when the incremental layout fails', async () => {
    const failure = await update('models/incremental/boundary.bpmn', changed(), []).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(BpmnError);
    expect(failure).toMatchObject({ code: 'E_LAYOUT_INCREMENTAL', category: 'layout', details: { hint: expect.stringContaining('`layout` operation') } });
  });

  it('keeps the drawing for a batch of drawing operations alone', async () => {
    await expect(update('models/incremental/boundary.bpmn', new ChangeSet(), [{ op: 'tidy' }])).rejects.toThrow(/DrawingOperationRunner is not ported yet/);
  });

  it('places a lone expansion request incrementally', async () => {
    const changes = new ChangeSet();
    changes.expansions.expand('SP', false);

    await expect(update('models/incremental/sub.bpmn', changes, [{ op: 'tidy' }])).rejects.toMatchObject({ code: 'E_LAYOUT_INCREMENTAL' });
  });
});
