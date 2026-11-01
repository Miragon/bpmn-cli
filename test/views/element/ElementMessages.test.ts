import { describe, expect, it } from 'vitest';
import { ElementLinks } from '../../../src/views/facts/ElementLinks.js';
import { ElementMessages } from '../../../src/views/element/ElementMessages.js';
import { Fixtures } from '../../support/Fixtures.js';

const messages = async (file = 'models/views/claims.bpmn') => {
  const document = await Fixtures.read(file);
  return { messages: new ElementMessages(document, new ElementLinks(document)), of: (id: string) => document.tree.require(id) };
};

describe('ElementMessages', () => {
  it('finds the message of an event and of a send task with its correlation key', async () => {
    const claims = await messages();
    const implementation = await messages('views/implementation.bpmn');

    expect(claims.messages.message(claims.of('Event_ClaimReceived'))).toMatchObject({ id: 'Message_Claim', name: 'Claim' });
    expect(implementation.messages.message(implementation.of('Notify'))).toMatchObject({ id: 'Message_Notice', correlationKey: '=order.id' });
    expect(claims.messages.message(claims.of('Activity_Pay'))).toBeUndefined();
  });

  it('adds the flows of its message that end at the pool of a message element', async () => {
    const { messages: read, of } = await messages();

    expect(read.flows(of('Event_CancelRequested'))).toEqual([]);
    expect(read.flows(of('Activity_SendDecision')).map(({ id }) => id)).toEqual(['Flow_Decision']);
    expect(read.flows(of('Flow_Claim'))).toEqual([]);
  });

  it('takes the flows of its message that end at the pool, a flow without message by its name', async () => {
    const { messages: read, of } = await messages('views/pool-messages.bpmn');

    expect(read.flows(of('Start_Order'))).toMatchObject([{ id: 'Flow_Order', direction: 'in', at: 'Pool_Shop', partner: { id: 'Pool_Customer' } }]);
    expect(read.flows(of('Receive_Order')).map(({ id }) => id)).toEqual(['Flow_Order']);
    expect(read.flows(of('Send_Receipt'))).toMatchObject([{ id: 'Flow_Named', direction: 'out', at: 'Pool_Shop' }]);
    expect(read.flows(of('End_Receipt')).map(({ id }) => id)).toEqual(['Flow_Named']);
  });

  it('lists who uses a message, an error and nothing for a task', async () => {
    const { messages: read, of } = await messages();

    expect(read.usedBy(of('Message_Claim'))?.map(({ id }) => id)).toEqual(['Flow_Claim', 'Event_ClaimReceived']);
    expect(read.usedBy(of('Error_Fraud'))).toMatchObject([{ id: 'Event_FraudSuspected' }]);
    expect(read.usedBy(of('Activity_Pay'))).toBeUndefined();
  });
});
