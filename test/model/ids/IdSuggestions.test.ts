import { describe, expect, it } from 'vitest';
import { IdSuggestions } from '../../../src/model/ids/IdSuggestions.js';
import { Fixtures } from '../../support/Fixtures.js';

describe('IdSuggestions', () => {
  async function suggestionsOf(path: string, batch?: ConstructorParameters<typeof IdSuggestions>[1]): Promise<IdSuggestions> {
    return new IdSuggestions((await Fixtures.read(path)).tree.all(), batch);
  }

  it('puts the id that differs only in case first, then the ids that share its stem', async () => {
    const suggestions = await suggestionsOf('model/events.bpmn');

    expect(suggestions.for('TASK_REVIEW')).toEqual(['task_review', 'CategoryValue_review', 'group_review', 'note_review']);
  });

  it('finds an id again from a typo, a missing underscore or a half-written id', async () => {
    const suggestions = await suggestionsOf('model/events.bpmn');

    expect(suggestions.for('task_reveiw')[0]).toBe('task_review');
    expect(suggestions.for('taskreview')).toEqual(['task_review']);
    expect(suggestions.for('start_timr')).toEqual(['start_timer']);
  });

  it('finds an element by its name, also when the name was typed without umlauts', async () => {
    const events = await suggestionsOf('model/events.bpmn');
    const speaking = await suggestionsOf('model/speaking-ids.bpmn');

    expect(events.for('Review order')).toEqual(['task_review']);
    expect(events.for('Approved?')).toEqual(['gateway_choice']);
    expect(speaking.for('Rechnung pruefen')).toEqual(['task_Rechnung']);
  });

  it('lists the ids of one prefix in order and gives at most the number asked for', async () => {
    const suggestions = await suggestionsOf('model/events.bpmn');

    expect(suggestions.for('task_')).toEqual(['task_inside', 'task_review', 'task_send']);
    expect(suggestions.for('task_', 2)).toEqual(['task_inside', 'task_review']);
  });

  it('suggests nothing for a word that matches no id and no name', async () => {
    const suggestions = await suggestionsOf('model/events.bpmn');

    expect(suggestions.for('xyzzy')).toEqual([]);
  });

  it('puts the id an element was renamed to first, and ids created in this batch ahead of older ones', async () => {
    const batch = { created: ['flow_yes'], renamed: new Map([['old_name', 'flow_no']]), aliases: () => ({}) };
    const plain = await suggestionsOf('model/events.bpmn');
    const inBatch = await suggestionsOf('model/events.bpmn', batch);

    expect(inBatch.for('old_name')).toEqual(['flow_no']);
    expect(plain.for('flow')).toEqual(['flow_choice', 'flow_day', 'flow_link', 'flow_no', 'flow_ready']);
    expect(inBatch.for('flow')).toEqual(['flow_yes', 'flow_choice', 'flow_day', 'flow_link', 'flow_no']);
  });
});
