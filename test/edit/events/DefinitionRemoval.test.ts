import { describe, expect, it } from 'vitest';
import { DefinitionRemoval } from '../../../src/edit/events/DefinitionRemoval.js';
import { EditSession } from '../../../src/edit/session/EditSession.js';
import { Fixtures } from '../../support/Fixtures.js';

async function editing() {
  const document = await Fixtures.readForWrite('edit/events-triggers.bpmn');
  return { document, removal: new DefinitionRemoval(new EditSession(document)) };
}

describe('DefinitionRemoval', () => {
  it('drops the definitions of an event and frees their ids for the next element', async () => {
    const { document, removal } = await editing();
    const event = document.tree.require('catch_message');

    expect(removal.dropAll(event, 'none')).toEqual([]);

    expect(event.get('eventDefinitions')).toEqual([]);
    expect(document.ids.registry.has('message_definition')).toBe(false);
  });

  it('warns what vendor content went with a definition', async () => {
    const { document, removal } = await editing();

    const warnings = removal.dropAll(document.tree.require('catch_retried'), 'message');

    expect(warnings).toEqual([expect.objectContaining({ code: 'W_PROPERTY_DROPPED', element: 'catch_retried', message: expect.stringMatching(/^camunda:failedJobRetryTimeCycle of the TimerEventDefinition timer_retries of catch_retried was dropped: the trigger changed to message/) })]);
  });

  it('keeps the one definition of a trigger and names the ones it dropped', async () => {
    const { document, removal } = await editing();
    const event = document.tree.require('catch_both');
    const keep = document.tree.require('both_timer');

    const [warning] = removal.dropOthers(event, keep, 'timer');

    expect(event.get('eventDefinitions')).toEqual([keep]);
    expect(warning?.message).toBe('messageEventDefinition both_message, signalEventDefinition both_signal of catch_both were dropped: trigger=timer keeps only its timerEventDefinition both_timer (an event acts on one event definition)');
    expect(document.ids.registry.has('both_message')).toBe(false);
  });

  it('says what a definition with vendor content carried when it is the only one to go', async () => {
    const document = await Fixtures.readForWrite('edit/events-triggers.bpmn');
    const event = document.tree.require('catch_message');
    const keep = document.tree.require('message_definition');
    const retried = document.tree.require('timer_retries');
    event.add('eventDefinitions', retried);

    const [warning] = new DefinitionRemoval(new EditSession(document)).dropOthers(event, keep, 'message');

    expect(warning?.message).toBe('timerEventDefinition timer_retries (with camunda:failedJobRetryTimeCycle) of catch_message was dropped: trigger=message keeps only its messageEventDefinition message_definition (an event acts on one event definition)');
  });
});
