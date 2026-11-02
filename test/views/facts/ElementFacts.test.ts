import { describe, expect, it } from 'vitest';
import { ElementFacts } from '../../../src/views/facts/ElementFacts.js';
import { Fixtures } from '../../support/Fixtures.js';

const facts = async (id: string, file = 'views/implementation.bpmn') => new ElementFacts((await Fixtures.read(file)).tree.require(id));

describe('ElementFacts', () => {
  it('refers to an element by id, kind and name, and to a missing one by a question mark', async () => {
    expect(ElementFacts.refOf(undefined)).toEqual({ id: '?', kind: '?' });
    expect((await facts('Charge')).ref()).toEqual({ id: 'Charge', kind: 'serviceTask', name: 'Charge' });
    expect((await facts('Process_Implementation')).ref()).toMatchObject({ kind: 'process', name: undefined });
  });

  it('tells a non-interrupting boundary or start event apart', async () => {
    expect((await facts('Event_CancelRequested', 'models/views/claims.bpmn')).nonInterrupting()).toBe(true);
    expect((await facts('Event_FraudSuspected', 'models/views/claims.bpmn')).nonInterrupting()).toBeUndefined();
    expect((await facts('Plain')).nonInterrupting()).toBeUndefined();
  });

  it('joins documentation and skips the blank entry', async () => {
    expect((await facts('Compute')).documentation()).toBe('Adds one.');
    expect((await facts('Plain')).documentation()).toBeUndefined();
  });

  it('reads the Camunda 8 settings as props, and leaves them out when asked', async () => {
    const charge = await facts('Charge');

    expect(charge.props()).toEqual({ loop: 'sequential', job: 'charge-card', inputCollection: '=items', inputElement: 'item' });
    expect(charge.props({ zeebe: false })).toEqual({ loop: 'sequential' });
    expect((await facts('Review')).props()).toEqual({ loop: 'standard', form: 'review-form', assignee: 'clerk', candidateGroups: 'office' });
    expect((await facts('Compute')).props()).toEqual({ scriptFormat: 'groovy', script: '=a + 1 -> b' });
    expect((await facts('CallC8')).props()).toEqual({ calledElement: 'billing-c8' });
  });

  it('reads what a task links to', async () => {
    expect((await facts('Call')).props()).toEqual({ calledElement: 'billing' });
    expect((await facts('Decide')).props()).toEqual({ calledDecision: 'pick-route' });
    expect((await facts('Notify')).props()).toEqual({ message: 'Notice' });
    expect((await facts('Compensate')).props()).toEqual({ isForCompensation: true });
    expect((await facts('Both')).props()).toEqual({ definitions: 'timer+message' });
    expect((await facts('Plain')).props()).toBeUndefined();
  });

  it('keys the vendor values of nested elements by their slot', async () => {
    expect((await facts('Flow_Resource')).vendorValues()).toEqual({ 'condition.camunda:resource': 'check.groovy' });
    expect((await facts('Plain')).vendorValues()).toBeUndefined();
  });

  it('lists the extension types in document order', async () => {
    expect((await facts('Call')).extensionElements()).toEqual(['camunda:in', 'camunda:in', 'camunda:executionListener']);
    expect((await facts('Plain')).extensionElements()).toBeUndefined();
  });

  it('reads a flow: name, condition, default', async () => {
    const flow = await facts('Flow_NotCovered', 'models/views/claims.bpmn');

    expect(flow.flowTraits()).toMatchObject({ name: 'no', default: true });
    expect((await facts('Flow_Covered', 'models/views/claims.bpmn')).flowTraits()).toMatchObject({ name: 'yes', condition: '${covered}' });
  });

  it('keeps a resource condition out of the vendor values of its flow', async () => {
    const flow = (await facts('Flow_Resource')).outgoingFlow();

    expect(flow).toMatchObject({ id: 'Flow_Resource', kind: 'sequenceFlow', target: { id: 'Review', kind: 'userTask' }, conditionResource: 'check.groovy', language: 'groovy' });
    expect(flow.attrs).toBeUndefined();
  });

  it('finds the correlation key of a Camunda 8 message', async () => {
    expect((await facts('Message_Notice')).correlationKey()).toBe('=order.id');
  });

  it('summarises what an element runs, one item per type', async () => {
    expect((await facts('Charge')).implementation()).toEqual({ attrs: undefined, ext: ['zeebe:taskDefinition type=charge-card retries=3', 'io: in amount; out receipt', 'zeebe:taskHeaders: channel', 'loop.zeebe:loopCharacteristics inputCollection==items inputElement=item'] });
    expect((await facts('Call')).implementation()).toEqual({ attrs: undefined, ext: ['camunda:in x2', 'camunda:executionListener event=start class=x.Y'] });
    expect((await facts('Plain')).implementation()).toBeUndefined();
  });

  it('cuts a long list of children and quotes a value with a semicolon', async () => {
    const { ext } = (await facts('Script')).implementation()!;

    expect(ext).toEqual(['camunda:script scriptFormat=groovy body="line one line two"', 'camunda:properties: one, two, three, four, five, six, +1 more', 'camunda:failedJobRetryTimeCycle body="R3/PT10M; then stop"', 'io: empty']);
  });
});
