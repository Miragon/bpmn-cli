import { describe, expect, it } from 'vitest';
import { EditSession } from '../../../src/edit/session/EditSession.js';
import { Fixtures } from '../../support/Fixtures.js';

async function session(platform?: 'c7' | 'c8') {
  const document = await Fixtures.readForWrite('edit/order-check.bpmn');
  return { document, edit: new EditSession(document, platform) };
}

describe('EditSession', () => {
  it('follows the call’s engine over the one the file declares', async () => {
    const { edit } = await session('c8');

    expect(edit.platform()).toBe('c8');
    expect((await session()).edit.platform()).toBe('none');
  });

  it('points a missing id to what the running batch created', async () => {
    const { edit } = await session();
    edit.batch = { created: ['ship'], renamed: new Map(), aliases: () => ({}) };

    expect(() => edit.require('gone')).toThrow(expect.objectContaining({ code: 'E_NOT_FOUND', details: expect.objectContaining({ hint: expect.stringContaining('Created earlier in this batch: ship') }) }));
  });

  it('hands out the renames once, with the old ends of a flow', async () => {
    const { document, edit } = await session();
    const flow = document.tree.require('flow_checkToOk');

    edit.recordRename('flow_a', 'flow_b', 'check -> ship', flow);
    edit.recordRegenerated('userTask_a', 'serviceTask_a');

    expect(edit.takeRenames()).toEqual([{ from: 'flow_a', to: 'flow_b', was: 'check -> ship' }, { from: 'userTask_a', to: 'serviceTask_a', regenerated: true }]);
    expect(edit.takeRenames()).toEqual([]);
  });

  it('keeps each former end of a node once and hands them to the element a retype made', async () => {
    const { document, edit } = await session();
    const [old, next] = [document.tree.require('check'), document.tree.require('ship')];
    const end = { id: 'check', labels: ['Check order'] };

    edit.recordFormerEnd(old, end);
    edit.recordFormerEnd(old, end);
    edit.replaceElement(old, next);

    expect(edit.formerEndsOf(old)).toEqual([]);
    expect(edit.formerEndsOf(next)).toEqual([end]);
  });

  it('keeps the first id state of a batch, so a batch compares its start with its end', async () => {
    const { edit } = await session();

    edit.recordIdState('check', { type: 'bpmn:UserTask' }, 'userTask');
    edit.recordIdState('check', { type: 'bpmn:Task' }, 'task');

    expect(edit.takeIdStates().get('check')?.wasLabel).toBe('userTask');
    expect(edit.takeIdStates().size).toBe(0);
  });

  it('forgets former ends and id states when a batch begins, and keeps dropped content', async () => {
    const { document, edit } = await session();
    const check = document.tree.require('check');

    edit.recordFormerEnd(check, { id: 'check', labels: [] });
    edit.recordDroppedContent({ element: 'check', kind: 'task', removed: ['ship'] });
    edit.begin();

    expect(edit.formerEndsOf(check)).toEqual([]);
    expect(edit.droppedContent).toHaveLength(1);
  });
});
