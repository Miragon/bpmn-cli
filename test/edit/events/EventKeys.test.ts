import { describe, expect, it } from 'vitest';
import { EventKeys } from '../../../src/edit/events/EventKeys.js';
import { EditSession } from '../../../src/edit/session/EditSession.js';
import { ChangeSet } from '../../support/ModelValues.js';
import { Fixtures } from '../../support/Fixtures.js';

async function writing(id: string, keys: Record<string, string>) {
  const document = await Fixtures.readForWrite('edit/events-triggers.bpmn');
  const changes = new ChangeSet();
  const element = document.tree.require(id);
  new EventKeys(new EditSession(document)).write(element, new Map(Object.entries(keys)), changes);
  return { document, element, changes };
}

describe('EventKeys', () => {
  it('sets a trigger with its detail and reports both', async () => {
    const { element, changes } = await writing('end_plain', { trigger: 'message', message: 'Paid' });

    expect(element.get<Array<{ type: string }>>('eventDefinitions')[0]?.type).toBe('bpmn:MessageEventDefinition');
    expect(changes.changed).toEqual([expect.objectContaining({ id: 'end_plain', detail: 'trigger=message message=Paid' })]);
  });

  it('takes the trigger from a key that belongs to one', async () => {
    const { changes } = await writing('catch_message', { timer: 'PT1H' });

    expect(changes.changed[0]?.detail).toBe('trigger=timer timer=PT1H');
  });

  it('keeps the trigger of an event when only its non-interrupting flag changes', async () => {
    const { element, changes } = await writing('boundary_timer', { nonInterrupting: 'false' });

    expect(element.get('cancelActivity')).toBe(true);
    expect(changes.changed[0]?.detail).toBe('nonInterrupting=false');
  });

  it('reads an empty non-interrupting as interrupting', async () => {
    const { element } = await writing('boundary_timer', { timer: 'PT9M', nonInterrupting: '' });

    expect(element.get('cancelActivity')).toBe(true);
  });

  it('names the new flag next to the trigger it came with', async () => {
    const { changes } = await writing('boundary_timer', { timer: 'PT9M', nonInterrupting: 'true' });

    expect(changes.changed[0]?.detail).toBe('trigger=timer timer=PT9M nonInterrupting=true');
  });

  it('takes an empty trigger for none, and an alias of a trigger for that trigger', async () => {
    const none = await writing('end_error', { trigger: '' });
    const alias = await writing('end_plain', { trigger: 'msg' });

    expect(none.element.get('eventDefinitions')).toEqual([]);
    expect(alias.changes.changed[0]?.detail).toBe('trigger=message');
  });

  it('takes an empty error code without a change to the error', async () => {
    const { document, changes } = await writing('end_error', { errorCode: '' });

    expect(document.tree.require('Error_late').get('errorCode')).toBe('E1');
    expect(changes.changed[0]?.detail).toBe('trigger=error');
  });

  it.each([
    ['a trigger BPMN does not know', 'end_plain', { trigger: 'rain' }, 'E_INVALID_VALUE'],
    ['a key of another trigger', 'catch_message', { trigger: 'message', timer: 'PT1H' }, 'E_INVALID_VALUE'],
    ['a key without a value', 'catch_message', { message: '' }, 'E_INVALID_VALUE'],
    ['a trigger the kind does not allow', 'end_plain', { timer: 'PT1H' }, 'E_INVALID_TRIGGER'],
    ['a trigger on a task', 'task_work', { message: 'Paid' }, 'E_INVALID_TRIGGER'],
  ])('refuses %s', async (_case, id, keys, code) => {
    await expect(writing(id, keys)).rejects.toMatchObject({ code });
  });

  it('refuses a trigger on what has no kind', async () => {
    const document = await Fixtures.readForWrite('edit/order-check.bpmn');
    const keys = new Map([['timer', 'PT1H']]);

    expect(() => new EventKeys(new EditSession(document)).write(document.tree.require('flow_checkToOk'), keys, new ChangeSet())).toThrow(expect.objectContaining({ code: 'E_INVALID_TRIGGER', message: expect.stringContaining('flow_checkToOk') }));
  });
});
