import { describe, expect, it } from 'vitest';
import { TriggerDescription } from '../../../src/views/facts/TriggerDescription.js';
import { Fixtures } from '../../support/Fixtures.js';

describe('TriggerDescription', () => {
  it.each([
    ['Both', 'PT1H'],
    ['Wait', 'timer'],
    ['WhenReady', 'condition ${ready}'],
    ['WhenAny', 'conditional'],
    ['LinkIn', 'link Jump'],
    ['LinkNameless', 'link'],
    ['Unnamed', 'message'],
    ['Stop', 'terminate'],
    ['Plain', undefined],
  ])('describes the trigger of %s', async (id, text) => {
    const document = await Fixtures.read('views/implementation.bpmn');

    expect(new TriggerDescription(document.tree.require(id)).text()).toBe(text);
  });

  it('names an error by its name and code, a message by its name', async () => {
    const document = await Fixtures.read('models/views/claims.bpmn');

    expect(new TriggerDescription(document.tree.require('Event_FraudSuspected')).text()).toBe('error Fraud (FRAUD)');
    expect(new TriggerDescription(document.tree.require('Event_ClaimReceived')).text()).toBe('message Claim');
    expect(new TriggerDescription(document.tree.require('Event_AssessStart')).text()).toBeUndefined();
  });
});
