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

  it('frees the ids of an element and what it holds', async () => {
    const document = await Fixtures.readForWrite('edit/sub-process.bpmn');
    const edit = new EditSession(document);

    edit.releaseIdsBelow(document.tree.require('Sub'));

    expect(document.ids.registry.has('Sub')).toBe(false);
    expect(document.ids.registry.has('Sub_task')).toBe(false);
    expect(document.ids.registry.has('start')).toBe(true);
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

  it('forgets former ends and id states when a batch begins, and keeps dropped content', async () => {
    const { document, edit } = await session();
    const check = document.tree.require('check');

    edit.recordFormerEnd(check, { id: 'check', labels: [] });
    edit.journal.recordIdState('check', { type: 'bpmn:UserTask' }, 'userTask');
    edit.journal.recordDroppedContent({ element: 'check', kind: 'task', removed: ['ship'] });
    edit.begin();

    expect(edit.formerEndsOf(check)).toEqual([]);
    expect(edit.journal.takeIdStates().size).toBe(0);
    expect(edit.journal.droppedContent).toHaveLength(1);
  });
});
