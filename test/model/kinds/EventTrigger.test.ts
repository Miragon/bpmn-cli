import { describe, expect, it } from 'vitest';
import { EventTrigger } from '../../../src/model/kinds/EventTrigger.js';
import { Fixtures } from '../../support/Fixtures.js';

describe('EventTrigger', () => {
  async function readOf(id: string, path = 'model/events.bpmn'): Promise<ReturnType<EventTrigger['read']>> {
    return new EventTrigger((await Fixtures.read(path)).tree.require(id)).read();
  }

  it.each([
    ['start_timer', { trigger: 'timer', opts: { timer: 'R/PT1H', timerKind: 'cycle' } }],
    ['catch_date', { trigger: 'timer', opts: { timer: '2026-12-24', timerKind: 'date' } }],
    ['boundary_soon', { trigger: 'timer', opts: { timer: 'PT5M', timerKind: 'duration', nonInterrupting: true } }],
    ['catch_condition', { trigger: 'conditional', opts: { when: '${ready}' } }],
    ['catch_link', { trigger: 'link', opts: { link: 'ToEnd' } }],
  ])('reads the trigger of the event %s as %j', async (id, expected) => {
    expect(await readOf(id)).toEqual(expected);
  });

  it('reads a message, an error and an escalation with the name of the root element and its code', async () => {
    expect(await readOf('end_escalation')).toEqual({ trigger: 'escalation', opts: { escalation: 'Up', escalationCode: 'E7' } });
    expect(await readOf('boundary_late')).toEqual({ trigger: 'error', opts: { error: 'Late', errorCode: 'E42' } });
    expect(await readOf('end_two')).toEqual({ trigger: 'message', opts: { message: 'OrderPlaced' } });
  });

  it('reads a non-interrupting message start event and a plain end event', async () => {
    expect(await readOf('start_message')).toEqual({ trigger: 'message', opts: { message: 'OrderPlaced', nonInterrupting: true } });
    expect(await readOf('end_plain')).toEqual({ trigger: 'none', opts: {} });
  });

  it('reads no trigger options from a message definition without a message', async () => {
    expect(await readOf('catch_message', 'model/gateways.bpmn')).toEqual({ trigger: 'message', opts: {} });
  });

  it('lets a boundary event stay non-interrupting unless the trigger always interrupts', async () => {
    const document = await Fixtures.read('model/events.bpmn');
    const boundary = document.tree.require('boundary_soon');
    const start = document.tree.require('start_timer');
    const link = document.tree.require('throw_link');

    expect([EventTrigger.interruptingOnly(boundary, 'timer'), EventTrigger.interruptingOnly(boundary, 'error')]).toEqual([false, true]);
    expect([EventTrigger.interruptingOnly(start, 'none'), EventTrigger.interruptingOnly(start, 'timer'), EventTrigger.interruptingOnly(start, 'compensate')]).toEqual([true, false, true]);
    expect(EventTrigger.interruptingOnly(link, 'message')).toBe(true);
  });
});
