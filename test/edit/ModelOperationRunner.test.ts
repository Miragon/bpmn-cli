import { describe, expect, it } from 'vitest';
import { ModelOperationRunner } from '../../src/edit/ModelOperationRunner.js';
import { OperationParser } from '../../src/operations/index.js';
import { Fixtures } from '../support/Fixtures.js';

async function run(ops: unknown[], path = 'edit/order-check.bpmn', options = {}) {
  const document = await Fixtures.readForWrite(path);
  const outcome = new ModelOperationRunner(document, options).run(new OperationParser().parse(ops));
  return { document, ...outcome };
}

describe('ModelOperationRunner', () => {
  it('hands each operation to its class and merges what they changed', async () => {
    const { changes } = await run([
      { op: 'add', kind: 'task', name: 'Review', after: 'startEvent_orderReceived' },
      { op: 'set', id: 'ship', set: { name: 'Ship it' } },
      { op: 'remove', ids: ['reject'] },
    ]);

    expect(changes.created.map(({ id }) => id)).toContain('task_review');
    expect(changes.changed.map(({ id }) => id)).toContain('ship');
    expect(changes.removed.map(({ id }) => id)).toContain('reject');
  });

  it('resolves an alias to the element it names after the ops before it renamed it', async () => {
    const { model, aliases } = await run([
      { op: 'add', kind: 'task', name: 'Review', after: 'check', as: '$review' },
      { op: 'set', id: '$review', set: { id: 'task_renamed' } },
      { op: 'set', id: '$review', set: { name: 'Renamed' } },
    ]);

    expect(model[2]).toMatchObject({ id: 'task_renamed' });
    expect(aliases).toEqual({ $review: 'task_renamed' });
  });

  it('keeps an alias on a task a retype replaced', async () => {
    const { document, aliases } = await run([
      { op: 'add', kind: 'task', name: 'Review', after: 'check', as: '$review' },
      { op: 'retype', id: '$review', kind: 'userTask' },
      { op: 'set', id: '$review', set: { name: 'Second look' } },
    ]);

    expect(aliases['$review']).toBe('userTask_review');
    expect(document.tree.require('userTask_review').name).toBe('Second look');
  });

  it('resolves the aliases of the drawing operations after the model ran', async () => {
    const { drawing } = await run([
      { op: 'add', kind: 'task', name: 'Review', after: 'check', as: '$review' },
      { op: 'color', ids: ['$review'], color: 'red' },
    ]);

    expect(drawing).toEqual([expect.objectContaining({ op: 'color', ids: ['task_review'] })]);
  });

  it('refuses a drawing operation on an element the batch removed, and names the op', async () => {
    await expect(run([{ op: 'remove', ids: ['ship'] }, { op: 'color', ids: ['ship'], color: 'red' }])).rejects.toMatchObject({ code: 'E_NOT_FOUND', details: { op: 1 } });
  });

  it('names the op that failed', async () => {
    await expect(run([{ op: 'set', id: 'ship', set: { name: 'x' } }, { op: 'remove', ids: ['nobody'] }])).rejects.toMatchObject({ code: 'E_NOT_FOUND', details: { op: 1 } });
  });

  it('drops a pool warning when a later op of the batch adds the pool', async () => {
    const { changes } = await run([
      { op: 'add', kind: 'lane', name: 'Sales' },
      { op: 'add', kind: 'participant', name: 'Shop' },
    ]);

    expect(changes.warnings.map(({ code }) => code)).not.toContain('W_LANES_WITHOUT_POOL');
  });

  it('keeps the warning about a task with two ways out unless a later op removes one', async () => {
    const connect = { op: 'connect', source: 'ship', target: 'reject' };

    expect((await run([connect])).changes.warnings.map(({ code }) => code)).toContain('W_IMPLICIT_SPLIT');
    expect((await run([connect, { op: 'remove', ids: ['flow_shipToJoin'], bridge: 'none' }])).changes.warnings.map(({ code }) => code)).not.toContain('W_IMPLICIT_SPLIT');
  });

  it('refuses a retype that would delete what a sub-process holds, unless forced', async () => {
    const retype = [{ op: 'retype', id: 'Sub', kind: 'task' }];
    const path = 'edit/sub-process.bpmn';

    await expect(run(retype, path)).rejects.toMatchObject({ code: 'E_WOULD_DROP_CONTENT' });
    expect((await run(retype, path, { force: true })).document.tree.has('Sub_task')).toBe(false);
  });

  it('follows the platform the call names', async () => {
    const { changes } = await run([{ op: 'add', kind: 'userTask', name: 'Review', after: 'check' }], 'edit/order-check.bpmn', { platform: 'c8' });

    expect(changes.notes.join()).toContain('zeebe:userTask');
  });
});
