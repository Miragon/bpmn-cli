import { describe, expect, it } from 'vitest';
import { InterruptingFlag } from '../../../src/edit/events/InterruptingFlag.js';
import { EditSession } from '../../../src/edit/session/EditSession.js';
import { Fixtures } from '../../support/Fixtures.js';

async function editing() {
  const document = await Fixtures.readForWrite('edit/events-triggers.bpmn');
  return { document, flag: new InterruptingFlag(new EditSession(document)) };
}

describe('InterruptingFlag', () => {
  it('makes a timer boundary event non-interrupting and interrupting again', async () => {
    const { document, flag } = await editing();
    const boundary = document.tree.require('boundary_error');

    flag.apply(boundary, 'timer', { nonInterrupting: true });
    expect(boundary.get('cancelActivity')).toBe(false);
    flag.apply(boundary, 'timer', { nonInterrupting: false });

    expect(boundary.get('cancelActivity')).toBe(true);
  });

  it('makes a boundary event interrupting when it becomes an error event, and leaves one with no wish', async () => {
    const { document, flag } = await editing();
    const boundary = document.tree.require('boundary_timer');

    flag.apply(boundary, 'message', {});
    expect(boundary.get('cancelActivity')).toBe(false);
    flag.apply(boundary, 'error', {});

    expect(boundary.get('cancelActivity')).toBe(true);
  });

  it('makes a start of an event sub-process non-interrupting and back', async () => {
    const { document, flag } = await editing();
    const start = document.tree.require('handler_plain');

    flag.apply(start, 'timer', { nonInterrupting: true });
    expect(start.get('isInterrupting')).toBe(false);
    flag.apply(start, 'timer', {});
    expect(start.get('isInterrupting')).toBe(false);
    flag.apply(start, 'timer', { nonInterrupting: false });

    expect(start.get('isInterrupting')).toBe(true);
  });

  it('makes a start interrupting when its new trigger always interrupts', async () => {
    const { document, flag } = await editing();
    const start = document.tree.require('handler_message');

    flag.apply(start, 'error', {});

    expect(start.get('isInterrupting')).toBe(true);
  });

  it.each([
    ['an error boundary event', 'boundary_error', 'error', 'A error boundary event cannot be non-interrupting'],
    ['a start outside an event sub-process', 'start_plain', 'timer', 'is not inside an event sub-process'],
    ['an error start of an event sub-process', 'handler_plain', 'error', 'A error start event cannot be non-interrupting'],
    ['a plain start of an event sub-process', 'handler_plain', 'none', 'A none start event cannot be non-interrupting'],
    ['an end event', 'end_plain', 'none', 'nonInterrupting only applies to boundary events'],
  ] as const)('refuses a non-interrupting %s', async (_case, id, trigger, message) => {
    const { document, flag } = await editing();

    expect(() => flag.apply(document.tree.require(id), trigger, { nonInterrupting: true })).toThrow(expect.objectContaining({ code: 'E_INVALID_TRIGGER', message: expect.stringContaining(message) }));
  });

  it('takes interrupting as given on an end event', async () => {
    const { document, flag } = await editing();

    expect(() => flag.apply(document.tree.require('end_plain'), 'none', { nonInterrupting: false })).not.toThrow();
  });
});
