import { describe, expect, it } from 'vitest';
import { NeighbourhoodView } from '../../../src/views/around/NeighbourhoodView.js';
import { Fixtures } from '../../support/Fixtures.js';

const view = async (id: string, depth?: number) => new NeighbourhoodView(await Fixtures.read('models/views/claims.bpmn')).answer(id, depth).view;

describe('NeighbourhoodView', () => {
  it('answers in the shape of the outline, with the cut and the depth it used', async () => {
    const answer = await view('Activity_Pay');

    expect(answer).toMatchObject({ kind: 'model', cut: { around: { id: 'Activity_Pay' }, depth: 1, nodes: { shown: 3, total: 16 }, flows: { shown: 3, total: 12 } } });
    expect(answer.processes[0]?.nodes.map(({ id }) => id)).toEqual(['Gateway_Covered', 'Activity_Pay', 'Activity_SendDecision']);
    expect(answer.processes[0]?.nodes.map(({ distance }) => distance)).toEqual([1, 0, 1]);
  });

  it('lists the message flows, annotations and data of the window', async () => {
    const answer = await view('Activity_Pay');
    const [process] = answer.processes;

    expect(answer.collaboration?.messageFlows.map(({ id }) => id)).toEqual(['Flow_Decision']);
    expect(process?.annotations).toMatchObject([
      { id: 'TextAnnotation_Pay', attachedTo: [{ id: 'Activity_Pay' }] },
      { id: 'TextAnnotation_Sla', attachedTo: [{ id: 'Activity_SendDecision' }] },
    ]);
    expect(process?.data).toMatchObject([{ id: 'DataObjectReference_ClaimFile', from: [], to: [{ id: 'Activity_Pay' }] }]);
  });

  it('heads a sub-process outside the window that holds window nodes, without a distance', async () => {
    const [heading] = (await view('Activity_RateDamage')).processes[0]!.nodes;

    expect(heading).toMatchObject({ id: 'Activity_Assess', distance: undefined });
    expect(heading?.children?.map(({ id }) => id)).toEqual(['Activity_CheckPolicy', 'Activity_RateDamage', 'Event_AssessEnd']);
  });

  it('counts the content of a sub-process with no node in the window, and flows from outside', async () => {
    const [assess] = (await view('Event_FraudSuspected')).processes[0]!.nodes;

    expect(assess).toMatchObject({ id: 'Activity_Assess', content: 4, from: [{ id: 'Flow_ToAssess', source: { id: 'Event_ClaimReceived' } }] });
    expect(assess?.boundary?.map(({ id }) => id)).toEqual(['Event_FraudSuspected']);
  });

  it('lists a boundary event at its scope when the host is outside the window', async () => {
    const nodes = (await view('Activity_Investigate')).processes[0]!.nodes;

    expect(nodes.find(({ id }) => id === 'Event_FraudSuspected')).toMatchObject({ host: { id: 'Activity_Assess' } });
  });

  it('leaves the reads of the implementation to impl, without Camunda 8 props', async () => {
    const document = await Fixtures.read('views/implementation.bpmn');
    const node = new NeighbourhoodView(document).answer('Review', 0).view.processes[0]?.nodes[0];

    expect(node?.props).toEqual({ loop: 'standard' });
    expect(node?.impl?.ext).toContain('zeebe:formDefinition formId=review-form');
  });
});
