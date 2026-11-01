import { describe, expect, it } from 'vitest';
import { ModelView } from '../../../src/views/model/ModelView.js';
import { Fixtures } from '../../support/Fixtures.js';

const claims = async () => new ModelView(await Fixtures.read('models/views/claims.bpmn'));

describe('ModelView', () => {
  it('answers with the whole model as data and as text', async () => {
    const { text, view } = (await claims()).answer();

    expect(view.kind).toBe('model');
    expect(view.cut).toBeUndefined();
    expect(view.definitions.namespaces).toEqual(['camunda']);
    expect(view.processes.map(({ id }) => id)).toEqual(['Process_Claims']);
    expect(text).toContain('process Process_Claims "Claims" executable in Participant_Insurer');
  });

  it('holds the collaboration with its pools, a black box, message flows and annotations', async () => {
    const { collaboration } = (await claims()).answer().view;

    expect(collaboration?.participants).toMatchObject([{ id: 'Participant_Insurer', process: { id: 'Process_Claims' } }, { id: 'Participant_Customer', process: undefined }]);
    expect(collaboration?.messageFlows[0]).toMatchObject({ id: 'Flow_Claim', source: { id: 'Participant_Customer' }, target: { id: 'Event_ClaimReceived' }, message: 'Claim' });
    expect(collaboration?.annotations).toMatchObject([{ id: 'TextAnnotation_Sla', attachedTo: [{ id: 'Activity_SendDecision' }] }]);
  });

  it('holds root elements with their code and correlation key', async () => {
    expect((await claims()).answer().view.rootElements).toContainEqual({ id: 'Error_Fraud', kind: 'error', name: 'Fraud', code: 'FRAUD', correlationKey: undefined });
    const { rootElements } = new ModelView(await Fixtures.read('views/implementation.bpmn')).answer().view;
    expect(rootElements).toMatchObject([{ id: 'Message_Notice', correlationKey: '=order.id' }]);
  });

  it('holds groups with their members', async () => {
    const { groups } = new ModelView(await Fixtures.read('models/incremental/groups.bpmn')).answer().view;

    expect(groups?.length).toBeGreaterThan(0);
    expect(groups?.[0]?.kind).toBe('group');
  });

  it('cuts to a part when asked', async () => {
    expect((await claims()).answer('Activity_Assess').view.cut?.in?.id).toBe('Activity_Assess');
  });

  it('holds no collaboration for a plain process', async () => {
    expect(new ModelView(await Fixtures.read('edit/plain-chain.bpmn')).answer().view.collaboration).toBeUndefined();
  });

  it('frames the view without its processes', async () => {
    expect((await claims()).frame()).toMatchObject({ kind: 'model', definitions: { namespaces: ['camunda'] } });
  });
});
