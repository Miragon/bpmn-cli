import { describe, expect, it } from 'vitest';
import { ElementDetail } from '../../../src/views/element/ElementDetail.js';
import { Fixtures } from '../../support/Fixtures.js';

const text = async (id: string, file = 'models/views/claims.bpmn') => new ElementDetail(await Fixtures.read(file)).answer(id).text;

describe('ElementDetailText', () => {
  it('prints everything needed to change a task, extensions numbered as ext remove takes them', async () => {
    expect(await text('Activity_CheckPolicy')).toBe(
      [
        'serviceTask Activity_CheckPolicy "Check policy"',
        'in: Participant_Insurer > Process_Claims > Activity_Assess · lane Lane_Office (via Activity_Assess)',
        'from: Event_AssessStart (Flow_ToCheck)   to: Activity_RateDamage (Flow_ToRate)',
        'caught by: Event_FraudSuspected (error Fraud (FRAUD)) on Activity_Assess -> Activity_Investigate',
        'event sub-processes: Activity_OnCancel in Process_Claims [Event_CancelRequested (message Cancel, non-interrupting) -> Event_Cancelled]',
        'attrs: camunda:type=external camunda:topic=check-policy',
        'ext 0: camunda:inputOutput  in policyId=${policyId}  out covered=${covered}',
      ].join('\n'),
    );
  });

  it('prints a boundary event with its host and to: none when it leads nowhere', async () => {
    const boundary = await text('Event_FraudSuspected');
    expect(boundary).toContain('on: Activity_Assess\nto: Activity_Investigate (Flow_ToInvestigate)');
    expect(await text('Stop', 'views/implementation.bpmn')).toContain('to: none');
  });

  it('marks the host of a non-interrupting boundary event', async () => {
    expect(await text('Event_Reminder', 'models/render/gallery.bpmn')).toContain('(non-interrupting)');
  });

  it('prints nested lanes, flows with conditions and data', async () => {
    expect(await text('Activity_SendDecision')).toContain('· lane Lane_Clerks (within Lane_Office)');
    expect(await text('Gateway_Covered')).toContain('to: Activity_Pay (Flow_Covered "yes" if ${covered}), Activity_SendDecision (Flow_NotCovered "no" default)');
    expect(await text('Activity_Pay')).toContain('reads: DataObjectReference_ClaimFile "Claim file"');
    expect(await text('Activity_RateDamage')).toContain('writes: DataObjectReference_ClaimFile "Claim file"');
    const data = await text('DataObjectReference_ClaimFile');
    expect(data).toContain('read by: Activity_Pay "Pay claim"');
    expect(data).toContain('written by: Activity_RateDamage "Rate damage"');
  });

  it('prints message flows with the partner, annotations and who uses a message', async () => {
    const send = await text('Activity_SendDecision');
    expect(send).toContain('message flows: out Flow_Decision "Decision" -> Participant_Customer "Customer"');
    expect(send).toContain('annotations: TextAnnotation_Sla "Answer within 5 days"');
    expect(await text('Participant_Customer')).toContain('message flows: out Flow_Claim "Claim" -> Event_ClaimReceived "Claim received" in Participant_Insurer "Insurer" [message Claim]; in Flow_Decision');
    expect(await text('Message_Claim')).toContain('used by: messageFlow Flow_Claim "Claim"; startEvent:message Event_ClaimReceived "Claim received"');
    expect(await text('Start_Order', 'views/pool-messages.bpmn')).toContain('message flows: in Flow_Order "Order" <- Pool_Customer "Customer" [message Order] (at pool Pool_Shop)');
  });

  it('prints children, members, what an annotation hangs on, and quotes attributes with spaces', async () => {
    expect(await text('Activity_Assess')).toContain('children: Event_AssessStart "Assessment started", ');
    expect(await text('Lane_Fraud')).toContain('members: ');
    expect(await text('TextAnnotation_Pay')).toContain('attached to: Activity_Pay "Pay claim"');
    expect(await text('TextAnnotation_Pay')).toContain('text="Paid by bank transfer"');
    expect(await text('Message_Notice', 'views/implementation.bpmn')).toContain('ext 0: zeebe:subscription correlationKey="=order.id"');
    expect(await text('Notify', 'views/implementation.bpmn')).toContain('message: Message_Notice "Notice" [correlationKey==order.id]');
  });

  it('numbers a nested extension by its slot', async () => {
    expect(await text('Charge', 'views/implementation.bpmn')).toContain('ext loop.0: zeebe:loopCharacteristics inputCollection="=items" inputElement="item"');
  });
});
