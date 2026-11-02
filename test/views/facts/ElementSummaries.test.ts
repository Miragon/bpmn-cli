import { describe, expect, it } from 'vitest';
import { ElementSummaries } from '../../../src/views/facts/ElementSummaries.js';
import { Fixtures } from '../../support/Fixtures.js';

describe('ElementSummaries', () => {
  it('sums up a node with its lane and outgoing flows', async () => {
    const document = await Fixtures.read('models/views/claims.bpmn');

    const summary = new ElementSummaries(document).summary(document.tree.require('Gateway_Covered'));

    expect(summary).toMatchObject({ id: 'Gateway_Covered', kind: 'exclusiveGateway', lane: { id: 'Lane_Clerks' } });
    expect(summary.outgoing.map(({ id }) => id)).toEqual(['Flow_Covered', 'Flow_NotCovered']);
  });

  it('leaves the lane to the host of a boundary event', async () => {
    const document = await Fixtures.read('models/views/claims.bpmn');

    expect(new ElementSummaries(document).summary(document.tree.require('Event_FraudSuspected'))).toMatchObject({ trigger: 'error Fraud (FRAUD)', lane: undefined });
  });

  it('leaves the Camunda 8 settings out when the view prints them in full', async () => {
    const document = await Fixtures.read('views/implementation.bpmn');

    expect(new ElementSummaries(document).summary(document.tree.require('Review'), { zeebe: false }).props).toEqual({ loop: 'standard' });
  });
});
