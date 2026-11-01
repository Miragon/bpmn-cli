import { describe, expect, it } from 'vitest';
import { ChangeSet } from '../../../src/model/document/ChangeSet.js';
import { Fixtures } from '../../support/Fixtures.js';

describe('IdAllocator', () => {
  const review = { key: 'task', name: 'review' };

  it('allocates the id a name asks for and numbers it when the model already has it', async () => {
    const { ids } = await Fixtures.read('model/events.bpmn');

    expect(ids.allocate({ key: 'userTask', name: 'Approve order' })).toEqual({ id: 'userTask_approveOrder', base: 'userTask_approveOrder' });
    expect(ids.allocate(review)).toEqual({ id: 'task_review2', base: 'task_review' });
    expect(ids.allocate(review)).toEqual({ id: 'task_review3', base: 'task_review' });
  });

  it('takes the id a user gave and allocates one only when none was given', async () => {
    const { ids, tree } = await Fixtures.read('model/events.bpmn');

    expect(ids.explicitOr('task_mine', review)).toBe('task_mine');
    expect(ids.explicitOr(undefined, review)).toBe('task_review2');
    expect(tree.has('task_mine')).toBe(false);
  });

  it('refuses an id that is no XML id, naming the element', async () => {
    const { ids } = await Fixtures.read('model/events.bpmn');

    expect(() => ids.claim('two words')).toThrow(expect.objectContaining({ code: 'E_INVALID_ID', details: expect.objectContaining({ element: 'two words' }) }));
  });

  it('refuses an id that the model or an earlier claim already holds', async () => {
    const { ids } = await Fixtures.read('model/events.bpmn');

    ids.claim('task_mine');

    expect(() => ids.claim('task_review')).toThrow(expect.objectContaining({ code: 'E_DUPLICATE_ID' }));
    expect(() => ids.claim('task_mine')).toThrow(expect.objectContaining({ code: 'E_DUPLICATE_ID' }));
  });

  it('remembers the base of the ids it generated in this batch until a batch begins', async () => {
    const { ids } = await Fixtures.read('model/events.bpmn');
    const { id } = ids.allocate(review);

    expect(ids.generatedBase(id)).toBe('task_review');
    expect(ids.generatedFrom(id, review)).toBe(true);
    expect(ids.generatedFrom(id, { key: 'task', name: 'other' })).toBe(false);

    ids.begin();

    expect(ids.generatedBase(id)).toBeUndefined();
  });

  it('forgets a generated id once a user claims it, and takes a base a caller marks', async () => {
    const { ids } = await Fixtures.read('model/events.bpmn');

    ids.markGenerated('task_marked', 'task_review');
    ids.claim('task_marked');

    expect(ids.generatedBase('task_marked')).toBeUndefined();
    expect(ids.baseOf(review)).toBe('task_review');
  });

  it('numbers a base past every id that is taken, or by a rule of the caller', async () => {
    const { ids } = await Fixtures.read('model/events.bpmn');

    expect(ids.suffixed('task_free', '_')).toBe('task_free');
    expect(ids.suffixed('task_review', '_')).toBe('task_review_2');
    expect(ids.suffixed('x', '_', (id) => ['x', 'x_2'].includes(id))).toBe('x_3');
  });

  it('numbers an id again and reports it as suffixed only when the base was taken', async () => {
    const { ids } = await Fixtures.read('model/events.bpmn');
    const changes = new ChangeSet();

    expect(ids.regenerated('task_free', '')).toBe('task_free');
    expect(ids.regenerated('task_review', '')).toBe('task_review2');

    ids.reportSuffixed(changes);

    expect(changes.warnings.map((warning) => [warning.code, warning.element])).toEqual([['W_ID_SUFFIXED', 'task_review2']]);
  });

  it('recognises an id derived from a request: the base itself or the base with a number', async () => {
    const { ids } = await Fixtures.read('model/events.bpmn');

    expect(['task_review', 'task_review2', 'task_review_3', 'task_reviewer', 'task_other'].map((id) => ids.isDerived(id, review))).toEqual([true, true, true, false, false]);
  });

  it('warns once per suffixed id, in the batch that suffixed it, and again only for a new one', async () => {
    const { ids } = await Fixtures.read('model/events.bpmn');
    const changes = new ChangeSet();
    ids.allocate(review);
    ids.reportSuffixed(changes);
    ids.reportSuffixed(changes);

    expect(changes.warnings).toHaveLength(1);
    expect(changes.warnings[0]).toMatchObject({ code: 'W_ID_SUFFIXED', element: 'task_review2', message: 'Id task_review is already taken; using task_review2' });

    changes.warnings.length = 0;
    ids.allocate(review);
    ids.reportSuffixed(changes);

    expect(changes.warnings.map((warning) => warning.element)).toEqual(['task_review3']);
  });
});
