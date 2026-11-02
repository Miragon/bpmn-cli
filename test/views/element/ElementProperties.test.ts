import { describe, expect, it } from 'vitest';
import { ElementProperties } from '../../../src/views/element/ElementProperties.js';
import { ElementSummaries } from '../../../src/views/facts/ElementSummaries.js';
import { Fixtures } from '../../support/Fixtures.js';

const attrs = async (id: string, file = 'models/views/claims.bpmn') => {
  const document = await Fixtures.read(file);
  const element = document.tree.require(id);
  return new ElementProperties(document).of(element, new ElementSummaries(document).summary(element));
};

describe('ElementProperties', () => {
  it('keys a service task as set takes it, vendor attributes included', async () => {
    expect(await attrs('Activity_CheckPolicy')).toEqual({ 'camunda:type': 'external', 'camunda:topic': 'check-policy' });
  });

  it('reads a flow without what its ends already say', async () => {
    expect(await attrs('Flow_Covered')).toEqual({ condition: '${covered}' });
    expect(await attrs('Flow_NotCovered')).toEqual({ default: true });
  });

  it('reads a sub-process, a default flow, a pool and a black box', async () => {
    expect(await attrs('Activity_OnCancel')).toMatchObject({ expanded: true, triggeredByEvent: true });
    expect(await attrs('Gateway_Covered')).toMatchObject({ default: 'Flow_NotCovered' });
    expect(await attrs('Participant_Insurer')).toEqual({ process: 'Process_Claims' });
    expect(await attrs('Participant_Customer')).toEqual({ blackBox: true });
  });

  it('reads annotations, the process and the root elements', async () => {
    expect(await attrs('TextAnnotation_Pay')).toMatchObject({ text: 'Paid by bank transfer' });
    expect(await attrs('Process_Claims')).toMatchObject({ isExecutable: true, 'camunda:historyTimeToLive': '180' });
    expect(await attrs('Error_Fraud')).toMatchObject({ errorCode: 'FRAUD' });
  });

  it('lists several event definitions under their position', async () => {
    expect(await attrs('Both', 'views/implementation.bpmn')).toMatchObject({ 'definition[0]': 'timerEventDefinition', 'definition[0].id': 'Def_Timer', 'definition[1]': 'messageEventDefinition' });
  });

  it('keys a nested vendor attribute by its slot', async () => {
    expect(await attrs('Flow_Resource', 'views/implementation.bpmn')).toEqual({ language: 'groovy', 'condition.camunda:resource': 'check.groovy' });
  });
});
