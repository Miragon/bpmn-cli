import { describe, expect, it } from 'vitest';
import { ModelOperationRunner } from '../../../src/edit/ModelOperationRunner.js';
import { Fixtures } from '../../support/Fixtures.js';

async function run(path: string, ops: unknown[]) {
  const document = await Fixtures.readForWrite(path);
  const { changes } = new ModelOperationRunner(document).run(Fixtures.operations(ops));
  const rootIds = document.tree.definitions.list('rootElements').map(({ id }) => id);
  return { changes, rootIds };
}

describe('EditConsequences', () => {
  it.each([
    ['removing every event that refers to it', 'edit/events-triggers.bpmn', [{ op: 'remove', ids: ['boundary_error', 'end_error'] }], 'Error_late'],
    ['removing every event that catches it', 'edit/events-triggers.bpmn', [{ op: 'remove', ids: ['catch_signal', 'catch_both'] }], 'Signal_stop'],
    ['changing the trigger of every event that refers to it', 'edit/events-triggers.bpmn', [{ op: 'remove', ids: ['end_error'] }, { op: 'set', id: 'boundary_error', set: { trigger: 'escalation', escalation: 'Up' } }], 'Error_late'],
    ['retyping the only task that sends it', 'edit/retype-elements.bpmn', [{ op: 'retype', id: 'send_paid', kind: 'userTask' }], 'Message_paid'],
    ['unlinking it from the only task that sends it', 'edit/retype-elements.bpmn', [{ op: 'set', id: 'send_paid', set: { message: '' } }], 'Message_paid'],
    ['removing the only task that sends it', 'edit/retype-elements.bpmn', [{ op: 'remove', ids: ['send_paid'] }], 'Message_paid'],
  ])('removes a root element the batch left unreferenced by %s', async (_case, path, ops, rootId) => {
    const { changes, rootIds } = await run(path, ops);

    expect(rootIds).not.toContain(rootId);
    expect(changes.removed).toContainEqual(expect.objectContaining({ id: rootId, detail: 'no longer referenced' }));
  });

  it('keeps a root element the file already left unreferenced', async () => {
    const { rootIds } = await run('edit/containers-one-pool.bpmn', [{ op: 'set', id: 'only_task', set: { name: 'Rework' } }]);

    expect(rootIds).toContain('Message_ping');
  });

  it('keeps a message the batch unlinks and links again', async () => {
    const { changes, rootIds } = await run('edit/retype-elements.bpmn', [
      { op: 'set', id: 'send_paid', set: { message: '' } },
      { op: 'set', id: 'send_paid', set: { message: 'Paid' } },
    ]);

    expect(rootIds).toContain('Message_paid');
    expect(changes.removed.map(({ id }) => id)).not.toContain('Message_paid');
  });

  it('merges the data association of a task moved into a collapsed sub-process that already reads the same data', async () => {
    const document = await Fixtures.readForWrite('layout/artifacts__04b-data-crossscope.bpmn');
    const { changes } = new ModelOperationRunner(document).run(
      Fixtures.operations([
        { op: 'set', id: 'Activity_Sub', set: { expanded: false } },
        { op: 'move', ids: ['Activity_Inform'], in: 'Activity_Sub' },
      ]),
    );

    expect(document.tree.require('Activity_Inform').list('dataInputAssociations')).toEqual([]);
    expect(document.tree.require('Activity_Sub').list('dataInputAssociations').map(({ id }) => id)).toEqual(['DataInputAssociation_4']);
    expect(changes.notes).toContain('DataInputAssociation_3 removed: the collapsed Activity_Sub already reads DataObjectReference_App');
  });
});
