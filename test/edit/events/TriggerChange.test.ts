import { describe, expect, it } from 'vitest';
import { TriggerChange } from '../../../src/edit/events/TriggerChange.js';
import { EditSession } from '../../../src/edit/session/EditSession.js';
import { ChangeSet } from '../../support/ModelValues.js';
import { Fixtures } from '../../support/Fixtures.js';

async function editing(id: string, path = 'edit/events-triggers.bpmn') {
  const document = await Fixtures.readForWrite(path);
  const session = new EditSession(document);
  const element = document.tree.require(id);
  return { document, session, element, change: new TriggerChange(session, element), changes: new ChangeSet() };
}

describe('TriggerChange', () => {
  it('reads the trigger an event has before the change', async () => {
    const { change } = await editing('boundary_timer');

    expect(change.current).toEqual({ trigger: 'timer', opts: { timer: 'PT5M', timerKind: 'duration', nonInterrupting: true } });
  });

  it('reads a task as having no trigger', async () => {
    const { change } = await editing('task_work');

    expect(change.current).toEqual({ trigger: 'none', opts: {} });
  });

  it('sets a new trigger with only the options given', async () => {
    const { element, change, changes } = await editing('catch_message');

    change.change('signal', { signal: 'Stop' }, changes);

    expect(element.list('eventDefinitions')[0]?.type).toBe('bpmn:SignalEventDefinition');
  });

  it('merges the options of the same trigger and forgets the old timer kind with a new timer', async () => {
    const { element, change, changes } = await editing('catch_retried');

    change.change('timer', { timer: 'R/PT1M' }, changes);

    expect(element.list('eventDefinitions')[0]?.get('timeCycle')).toBeDefined();
  });

  it('keeps an event non-interrupting through a strict change', async () => {
    const { element, change, changes } = await editing('boundary_timer');

    change.change('timer', { timer: 'PT9M' }, changes, { strict: true });

    expect(element.get('cancelActivity')).toBe(false);
  });

  it('refuses a strict change that keeps a flag the new trigger cannot have', async () => {
    const { change, changes } = await editing('boundary_timer');

    expect(() => change.change('error', { nonInterrupting: true }, changes, { strict: true })).toThrow(expect.objectContaining({ code: 'E_INVALID_TRIGGER', message: 'error boundary events are always interrupting (boundary_timer)' }));
  });

  it('warns when a boundary event loses its non-interrupting flag to a new trigger', async () => {
    const { element, change, changes } = await editing('boundary_timer');

    change.change('error', {}, changes);

    expect(element.get('cancelActivity')).toBe(true);
    expect(changes.warnings[0]).toMatchObject({ code: 'W_PROPERTY_DROPPED', message: expect.stringContaining('error boundary events are always interrupting') });
  });

  it('warns when a start event loses its non-interrupting flag to no trigger', async () => {
    const { change, changes } = await editing('handler_message');

    change.change('none', {}, changes);

    expect(changes.warnings[0]?.message).toContain('untyped start events are always interrupting');
    expect(changes.warnings[0]?.hint).toContain('the enclosing process');
  });

  it('passes on what the definitions warn about', async () => {
    const { change, changes } = await editing('catch_retried');

    change.change('message', {}, changes);

    expect(changes.warnings.map(({ code }) => code)).toEqual(['W_PROPERTY_DROPPED']);
  });

  it('changes nothing without a trigger', async () => {
    const { element, change, changes } = await editing('catch_message');

    change.change(undefined, {}, changes);

    expect(element.list('eventDefinitions')).toHaveLength(1);
  });

  it('refuses a trigger that breaks a message flow out of a throw event', async () => {
    const { change, changes } = await editing('throw_invoice', 'edit/events-message-flows.bpmn');

    expect(() => change.change('signal', {}, changes)).toThrow(expect.objectContaining({
      code: 'E_INVALID_TRIGGER',
      message: 'intermediateThrowEvent:signal throw_invoice would break message flow flow_invoice (throw_invoice -> catch_invoice): a signal event cannot send messages',
      details: expect.objectContaining({ related: ['flow_invoice'] }),
    }));
  });

  it('refuses a trigger that breaks a message flow into a catch event', async () => {
    const { change, changes } = await editing('catch_invoice', 'edit/events-message-flows.bpmn');

    expect(() => change.change('timer', { timer: 'PT1H' }, changes)).toThrow(expect.objectContaining({ code: 'E_INVALID_TRIGGER', message: expect.stringContaining('a timer event cannot receive messages') }));
  });

  it('lets a message flow that was broken before stay broken', async () => {
    const { change, changes } = await editing('throw_timed', 'edit/events-message-flows.bpmn');

    expect(() => change.change('escalation', {}, changes)).not.toThrow();
  });

  it('flips the non-interrupting flag of a boundary event and of an event sub-process start', async () => {
    const boundary = await editing('boundary_timer');
    const start = await editing('handler_message');

    boundary.change.setNonInterrupting(false);
    start.change.setNonInterrupting(false);

    expect(boundary.element.get('cancelActivity')).toBe(true);
    expect(start.element.get('isInterrupting')).toBe(true);
  });

  it('takes the flag on a start of an event sub-process with a trigger', async () => {
    const { element, change } = await editing('handler_message');

    change.setNonInterrupting(true);

    expect(element.get('isInterrupting')).toBe(false);
  });

  it.each([
    ['an error boundary event', 'boundary_error', true, 'E_INVALID_TRIGGER', 'error boundary events are always interrupting'],
    ['a start of a process', 'start_plain', true, 'E_INVALID_TRIGGER', 'is not inside an event sub-process'],
    ['a plain start of an event sub-process', 'handler_plain', true, 'E_INVALID_TRIGGER', 'An untyped start event cannot be non-interrupting'],
    ['an end event', 'end_plain', true, 'E_INVALID_VALUE', 'can be non-interrupting'],
    ['an end event, even to interrupting', 'end_plain', false, 'E_INVALID_VALUE', 'can be non-interrupting'],
  ])('refuses the flag on %s', async (_case, id, value, code, message) => {
    const { change } = await editing(id);

    expect(() => change.setNonInterrupting(value)).toThrow(expect.objectContaining({ code, message: expect.stringContaining(message) }));
  });

  it('refuses a message trigger start that an error start cannot keep non-interrupting', async () => {
    const { change, changes } = await editing('handler_message');

    expect(() => change.change('error', { nonInterrupting: true }, changes, { strict: true })).toThrow(expect.objectContaining({ code: 'E_INVALID_TRIGGER', message: 'A error start event cannot be non-interrupting (handler_message)' }));
  });
});
