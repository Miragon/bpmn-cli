import { describe, expect, it } from 'vitest';
import { EditJournal } from '../../../src/edit/session/EditJournal.js';
import { Fixtures } from '../../support/Fixtures.js';
import { ChangeEntries } from '../../support/ModelValues.js';

describe('EditJournal', () => {
  it('hands over the renames of a step once, with the old ends of a flow', () => {
    const journal = new EditJournal();

    journal.recordRename('flow_a', 'flow_b', 'check -> ship');
    journal.recordRegenerated('userTask_a', 'serviceTask_a');

    expect(journal.takeRenames()).toEqual([{ from: 'flow_a', to: 'flow_b', was: 'check -> ship' }, { from: 'userTask_a', to: 'serviceTask_a', regenerated: true }]);
    expect(journal.takeRenames()).toEqual([]);
  });

  it('says about which element a rename speaks, and what a regenerated id was', async () => {
    const document = await Fixtures.readForWrite('edit/order-check.bpmn');
    const journal = new EditJournal();
    const flow = document.tree.require('flow_checkToOk');

    journal.recordRename('old_flow', flow.id, undefined, flow);
    journal.recordRegenerated('userTask_a', 'serviceTask_a', 'userTask', flow);

    const [renamed, regenerated] = journal.takeRenames();
    expect(ChangeEntries.elementOf(renamed!)).toBe(flow);
    expect(regenerated).toMatchObject({ from: 'userTask_a', was: 'userTask', regenerated: true });
  });

  it('keeps the first id state of an element a batch touches twice', () => {
    const journal = new EditJournal();

    journal.recordIdState('check', { type: 'bpmn:UserTask' }, 'userTask');
    journal.recordIdState('check', { type: 'bpmn:Task' }, 'task');

    expect(journal.takeIdStates().get('check')?.wasLabel).toBe('userTask');
    expect(journal.takeIdStates().size).toBe(0);
  });

  it('lists the content a retype would drop', () => {
    const journal = new EditJournal();

    journal.recordDroppedContent({ element: 'Sub', kind: 'task', removed: ['Sub_task'] });

    expect(journal.droppedContent).toEqual([{ element: 'Sub', kind: 'task', removed: ['Sub_task'] }]);
  });
});
