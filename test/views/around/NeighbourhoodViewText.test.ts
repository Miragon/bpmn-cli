import { describe, expect, it } from 'vitest';
import { NeighbourhoodView } from '../../../src/views/around/NeighbourhoodView.js';
import { Fixtures } from '../../support/Fixtures.js';

const text = async (id: string, depth?: number, file = 'models/views/claims.bpmn') => new NeighbourhoodView(await Fixtures.read(file)).answer(id, depth).text;

describe('NeighbourhoodViewText', () => {
  it('shows the neighbourhood nested like show, with what was left out', async () => {
    expect(await text('Activity_CheckPolicy', 2)).toBe(
      [
        'around Activity_CheckPolicy (depth 2): 5 of 16 nodes, 3 of 12 flows; 11 nodes, 9 flows omitted',
        'process Process_Claims "Claims" in Participant_Insurer "Insurer"',
        '  subProcess Activity_Assess "Assess claim" [lane=Lane_Office, expanded] <- Event_ClaimReceived (Flow_ToAssess) -> Gateway_Covered (Flow_ToCovered)',
        '    startEvent Event_AssessStart "Assessment started" -> Activity_CheckPolicy (Flow_ToCheck)',
        '    serviceTask Activity_CheckPolicy "Check policy" [camunda:type=external, camunda:topic=check-policy, io: in policyId; out covered] -> Activity_RateDamage (Flow_ToRate)',
        '    userTask Activity_RateDamage "Rate damage" [camunda:assignee=clerk] -> Event_AssessEnd (Flow_ToAssessEnd)',
        '    endEvent Event_AssessEnd "Assessed"',
        'data:',
        '  dataObject DataObjectReference_ClaimFile "Claim file" (from Activity_RateDamage)',
      ].join('\n'),
    );
  });

  it('heads a sub-process outside the window and shows flows from outside after <-', async () => {
    expect(await text('Activity_RateDamage', 1)).toContain('  in subProcess Activity_Assess "Assess claim" [lane=Lane_Office]:\n    serviceTask Activity_CheckPolicy "Check policy" [camunda:type=external, camunda:topic=check-policy, io: in policyId; out covered] <- Event_AssessStart (Flow_ToCheck) -> Activity_RateDamage (Flow_ToRate)');
  });

  it('counts the content of a sub-process and names the host outside the window', async () => {
    expect(await text('Event_FraudSuspected', 1)).toContain('[lane=Lane_Office, expanded, content: 4 nodes]');
    expect(await text('Activity_Investigate', 1)).toContain('  boundaryEvent:error Event_FraudSuspected "Fraud suspected" [on Activity_Assess, error Fraud (FRAUD)] -> Activity_Investigate (Flow_ToInvestigate)');
  });

  it('prints the message flows and annotations of the window', async () => {
    const shown = await text('Activity_SendDecision', 0);

    expect(shown).toContain('message flows:\n  messageFlow Flow_Decision "Decision"');
    expect(shown).toContain('annotations:\n  TextAnnotation_Sla "Answer within 5 days" ~ Activity_SendDecision');
  });

  it('omits the omitted part when the window holds everything', async () => {
    expect((await text('X', 9, 'edit/plain-chain.bpmn')).split('\n')[0]).toBe('around X (depth 9): 5 of 5 nodes, 4 of 4 flows');
  });

  it('prints the implementation of a Camunda 8 task whole', async () => {
    expect(await text('Charge', 0, 'views/implementation.bpmn')).toContain('zeebe:taskDefinition type=charge-card retries=3, io: in amount; out receipt, zeebe:taskHeaders: channel');
  });
});
