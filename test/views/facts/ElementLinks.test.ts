import { describe, expect, it } from 'vitest';
import { ElementLinks } from '../../../src/views/facts/ElementLinks.js';
import { Fixtures } from '../../support/Fixtures.js';

const claims = async () => {
  const document = await Fixtures.read('models/views/claims.bpmn');
  return { document, links: new ElementLinks(document), of: (id: string) => document.tree.require(id) };
};

describe('ElementLinks', () => {
  it('walks the scopes of a process, sub-processes included', async () => {
    const { links, of } = await claims();

    expect(links.scopesWithin(of('Process_Claims')).map(({ id }) => id)).toEqual(['Process_Claims', 'Activity_Assess', 'Activity_OnCancel']);
  });

  it('finds the pool of a node, and a pool is its own', async () => {
    const { links, of } = await claims();

    expect(links.poolOf(of('Activity_Pay'))?.id).toBe('Participant_Insurer');
    expect(links.poolOf(of('Participant_Customer'))?.id).toBe('Participant_Customer');
    expect(links.poolOf(of('Message_Claim'))).toBeUndefined();
  });

  it('names the partner of a message flow with its pool', async () => {
    const { links, of } = await claims();

    expect(links.partnerFlows(of('Participant_Customer'))).toMatchObject([
      { direction: 'out', id: 'Flow_Claim', name: 'Claim', message: 'Claim', partner: { id: 'Event_ClaimReceived' }, pool: { id: 'Participant_Insurer' } },
      { direction: 'in', id: 'Flow_Decision', partner: { id: 'Activity_SendDecision' } },
    ]);
    expect(links.partnerFlows(of('Activity_SendDecision'))[0]?.pool).toBeUndefined();
  });

  it('gives a message flow its ends', async () => {
    const { links, of } = await claims();

    expect(links.messageFlowEnds(of('Flow_Claim'))).toMatchObject({ source: { id: 'Participant_Customer' }, target: { id: 'Event_ClaimReceived' }, message: 'Claim' });
  });

  it('inherits the lane of the host and of the enclosing sub-process', async () => {
    const { links, of } = await claims();

    expect(links.effectiveLane(of('Activity_Pay'))?.lane.id).toBe('Lane_Clerks');
    expect(links.effectiveLane(of('Event_FraudSuspected'))).toMatchObject({ lane: { id: 'Lane_Office' }, via: { id: 'Activity_Assess' } });
    expect(links.effectiveLane(of('Activity_CheckPolicy'))).toMatchObject({ lane: { id: 'Lane_Office' }, via: { id: 'Activity_Assess' } });
    expect(links.effectiveLane(of('Process_Claims'))).toBeUndefined();
  });
});
