import { describe, expect, it } from 'vitest';
import { LoopKeys } from '../../../src/edit/properties/LoopKeys.js';
import { EditSession } from '../../../src/edit/session/EditSession.js';
import { Fixtures } from '../../support/Fixtures.js';
import { type BpmnElement, ChangeSet } from '../../support/ModelValues.js';

async function write(id: string, key: string, value: string) {
  const document = await Fixtures.readForWrite('edit/properties-loops.bpmn');
  const activity = document.tree.require(id);
  const changes = new ChangeSet();
  new LoopKeys(new EditSession(document)).write(activity, key, value, changes);
  return { document, activity, changes, loop: activity.get<BpmnElement | undefined>('loopCharacteristics') };
}

describe('LoopKeys', () => {
  it.each([
    ['parallel', false],
    ['sequential', true],
    [' Parallel ', false],
  ])('makes a task a %s multi-instance', async (value, isSequential) => {
    const { loop } = await write('task_plain', 'loop', value);

    expect(loop?.is('bpmn:MultiInstanceLoopCharacteristics')).toBe(true);
    expect(loop?.get('isSequential')).toBe(isSequential);
  });

  it('turns a sequential multi-instance parallel and keeps what it holds', async () => {
    const { loop, changes } = await write('task_multi', 'loop', 'parallel');

    expect(loop?.get('isSequential')).toBe(false);
    expect(loop?.attrs['camunda:collection']).toBe('items');
    expect(changes.warnings).toEqual([]);
  });

  it('gives a task a standard loop', async () => {
    expect((await write('task_plain', 'loop', 'standard')).loop?.is('bpmn:StandardLoopCharacteristics')).toBe(true);
  });

  it('leaves a standard loop as it is', async () => {
    const { loop } = await write('task_standard', 'loop', 'standard');

    expect(loop?.id).toBe('loop_standard');
  });

  it('replaces a standard loop with a multi-instance and frees its id', async () => {
    const { document, loop } = await write('task_standard', 'loop', 'parallel');

    expect(loop?.is('bpmn:MultiInstanceLoopCharacteristics')).toBe(true);
    expect(document.ids.registry.has('loop_standard')).toBe(false);
  });

  it('warns about the vendor content a replaced loop takes with it', async () => {
    const { changes } = await write('task_multi', 'loop', 'standard');

    expect(changes.warnings).toEqual([expect.objectContaining({ code: 'W_PROPERTY_DROPPED', element: 'task_multi', message: expect.stringMatching(/^camunda:collection of the .* loop_multi of task_multi was dropped: loop=standard replaces it$/) })]);
  });

  it('names each thing a removed loop takes with it', async () => {
    const { changes } = await write('task_two_vendor', 'loop', 'none');

    expect(changes.warnings[0]?.message).toMatch(/^camunda:collection, camunda:elementVariable of the [^ ]+.* of task_two_vendor were dropped: loop=none removes the loop$/);
  });

  it.each(['none', ''])('removes the loop with %j', async (value) => {
    const { loop, changes } = await write('task_standard', 'loop', value);

    expect(loop).toBeUndefined();
    expect(changes.warnings).toEqual([]);
  });

  it('removing no loop does nothing', async () => {
    expect((await write('task_plain', 'loop', 'none')).changes.warnings).toEqual([]);
  });

  it('refuses a loop mode BPMN does not have', async () => {
    await expect(write('task_plain', 'loop', 'forever')).rejects.toMatchObject({ code: 'E_INVALID_VALUE', details: { element: 'task_plain' } });
  });

  it('creates a parallel multi-instance for a cardinality and says so', async () => {
    const { loop, changes } = await write('task_plain', 'cardinality', '5');

    expect(loop?.get<BpmnElement>('loopCardinality').get('body')).toBe('5');
    expect(changes.notes).toEqual(['task_plain: created a parallel multi-instance loop for cardinality']);
  });

  it('replaces the completion condition of a multi-instance', async () => {
    const { loop, changes } = await write('task_multi', 'completion', '${enough}');

    expect(loop?.get<BpmnElement>('completionCondition').get('body')).toBe('${enough}');
    expect(changes.notes).toEqual([]);
  });

  it('removes a cardinality and a completion condition from a multi-instance', async () => {
    expect((await write('task_multi', 'cardinality', '')).loop?.get('loopCardinality')).toBeUndefined();
    expect((await write('task_multi', 'completion', '')).loop?.get('completionCondition')).toBeUndefined();
  });

  it('removing a cardinality from a task without a multi-instance does nothing', async () => {
    expect((await write('task_standard', 'cardinality', '')).loop?.id).toBe('loop_standard');
    expect((await write('task_plain', 'cardinality', '')).loop).toBeUndefined();
  });

  it('refuses a cardinality on a standard loop', async () => {
    await expect(write('task_standard', 'cardinality', '5')).rejects.toMatchObject({ code: 'E_INVALID_VALUE', message: expect.stringContaining('task_standard has a standard loop') });
  });

  it('sets the completion condition of an ad-hoc sub-process on the sub-process', async () => {
    const { activity, loop } = await write('sub_adhoc', 'completion', '${enough}');

    expect(activity.get<BpmnElement>('completionCondition').get('body')).toBe('${enough}');
    expect(loop).toBeUndefined();
  });

  it('removes the completion condition of an ad-hoc sub-process', async () => {
    expect((await write('sub_adhoc', 'completion', '')).activity.get('completionCondition')).toBeUndefined();
  });

  it('sets the completion condition of an ad-hoc multi-instance on its loop', async () => {
    const { activity, loop } = await write('sub_adhoc_multi', 'completion', '${enough}');

    expect(loop?.get<BpmnElement>('completionCondition').get('body')).toBe('${enough}');
    expect(activity.get('completionCondition')).toBeUndefined();
  });
});
