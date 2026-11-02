import { describe, expect, it } from 'vitest';
import { DiagramDrawing } from '../../src/drawing/DiagramDrawing.js';
import { DrawingSnapshot } from '../../src/drawing/DrawingSnapshot.js';
import { BpmnError, ChangeSet } from '../support/ModelValues.js';
import { DrawingPair } from '../support/DrawingPair.js';
import { Fixtures } from '../support/Fixtures.js';

describe('DiagramDrawing', () => {
  async function update(path: string, changes: ChangeSet, operations: Parameters<DiagramDrawing['update']>[2]) {
    const document = await Fixtures.read(path);
    return new DiagramDrawing(document).update(DrawingSnapshot.of(document), changes, operations);
  }

  it('draws an empty plane in full', async () => {
    await expect(update('drawing/empty-diagram.bpmn', new ChangeSet(), [])).resolves.toMatchObject({ mode: 'full' });
  });

  it('draws in full on a layout operation, however drawn the plane, and redraws vertical lanes', async () => {
    await expect(update('models/incremental/boundary.bpmn', new ChangeSet(), [{ op: 'layout' }])).resolves.toMatchObject({ mode: 'full' });
    await expect(update('models/incremental/vertical.bpmn', new ChangeSet(), [{ op: 'layout' }])).resolves.toMatchObject({ mode: 'full' });
  });

  it('reports the ids a full drawing gave to elements without one', async () => {
    const changes = new ChangeSet();

    const report = await update('drawing/idless.bpmn', changes, [{ op: 'layout' }]);

    expect(report.mode).toBe('full');
    expect(changes.notes.at(-1)).toContain('without id got one');
    expect(changes.changed.at(-1)?.detail).toContain('id added');
  });

  it('places the elements the ChangeSet names and keeps the drawing', async () => {
    const { document, before, changes } = await DrawingPair.read('add-after');

    const report = await new DiagramDrawing(document).update(before, changes, []);

    expect(report.mode).toBe('incremental');
    expect(report.placed).toContain('serviceTask_fz1ShipNotifyPaymentOrderApproveAndShip');
  });

  it('keeps the drawing for a batch of drawing operations alone', async () => {
    await expect(update('models/incremental/boundary.bpmn', new ChangeSet(), [{ op: 'tidy' }])).resolves.toMatchObject({ mode: 'kept', placed: [] });
  });

  it('places a lone expansion request incrementally', async () => {
    const changes = new ChangeSet();
    changes.expansions.expand('SP', false);

    await expect(update('models/incremental/sub.bpmn', changes, [{ op: 'tidy' }])).resolves.toMatchObject({ mode: 'incremental', notes: ['SP drawn collapsed'] });
  });

  it('refuses with E_LAYOUT_INCREMENTAL and the hint when the incremental layout fails', async () => {
    const document = await Fixtures.read('models/incremental/boundary.bpmn');
    const before = DrawingSnapshot.of(document);
    before.pruneReEnded = () => {
      throw new Error('the drawing went away');
    };

    const failure = await new DiagramDrawing(document).update(before, new ChangeSet().change({ id: 'A', kind: 'task' }), []).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(BpmnError);
    expect(failure).toMatchObject({ code: 'E_LAYOUT_INCREMENTAL', category: 'layout', details: { hint: expect.stringContaining('`layout` operation') } });
  });

  it('refuses a step that must place on a vertical plane and names a last layout operation', async () => {
    const before = Fixtures.text('models/incremental/vertical.bpmn');
    const added = before.replace('<bpmn:task id="A"', '<bpmn:task id="New" name="New"/><bpmn:task id="A"');
    const parts = await DrawingPair.of(before, added, { created: ['New'], changed: [], removed: [], relocated: [], expand: [], collapse: [], renamed: [] });

    await expect(new DiagramDrawing(parts.document).update(parts.before, parts.changes, [])).rejects.toMatchObject({ code: 'E_LAYOUT_INCREMENTAL', details: { hint: expect.stringContaining('horizontal') } });
  });

  it('relabels a group the snapshot shows renamed and draws groups without a shape', async () => {
    const document = await Fixtures.read('models/incremental/groups.bpmn');
    const before = DrawingSnapshot.of(document);
    const [group] = before.groupNames.keys();
    group!.peek<{ set(property: string, value: string): void }>('categoryValueRef')?.set('value', 'Renamed');

    await new DiagramDrawing(document).update(before, new ChangeSet().change({ id: 'G1', kind: 'group' }), []);

    expect(group!.name).toBe('Renamed');
  });
});
