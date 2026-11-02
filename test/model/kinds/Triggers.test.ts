import { describe, expect, it } from 'vitest';
import { Triggers } from '../../../src/model/kinds/Triggers.js';
import { Fixtures } from '../../support/Fixtures.js';

describe('Triggers', () => {
  it.each([
    ['MSG', 'message'],
    ['condition', 'conditional'],
    ['compensation', 'compensate'],
    ['Time', 'timer'],
    [' none ', 'none'],
    ['', undefined],
    ['bogus', undefined],
  ])('reads "%s" as the trigger %s', (raw, trigger) => {
    expect(Triggers.normalize(raw)).toBe(trigger);
  });

  it('reads the trigger of an event from its first event definition, none without one, and nothing for a task', async () => {
    const document = await Fixtures.read('model/events.bpmn');
    const triggerOf = (id: string): string | undefined => Triggers.of(document.tree.require(id));

    expect(['start_timer', 'boundary_late', 'catch_condition', 'end_two', 'end_plain', 'task_review'].map(triggerOf)).toEqual(['timer', 'error', 'conditional', 'message', 'none', undefined]);
  });

  it('names the trigger of an event definition and none for anything else', async () => {
    const document = await Fixtures.read('model/events.bpmn');

    expect(Triggers.ofDefinition(document.tree.require('timer_cycle'))).toBe('timer');
    expect(Triggers.ofDefinition(document.tree.require('Process_events'))).toBeUndefined();
  });

  it('tells a link throw event from a link catch event', async () => {
    const document = await Fixtures.read('model/events.bpmn');
    const [thrown, caught, task] = ['throw_link', 'catch_link', 'task_review'].map((id) => document.tree.require(id));

    expect([Triggers.isLinkThrow(thrown!), Triggers.isLinkThrow(caught!), Triggers.isLinkCatch(caught!), Triggers.isLinkCatch(task!)]).toEqual([true, false, true, false]);
  });
});
