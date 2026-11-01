import { describe, expect, it } from 'vitest';
import { ElementDetail } from '../../../src/views/element/ElementDetail.js';
import { Fixtures } from '../../support/Fixtures.js';

const view = async (id: string, file = 'models/views/claims.bpmn') => new ElementDetail(await Fixtures.read(file)).answer(id).view;

describe('ElementDetail', () => {
  it('says where a task in a sub-process sits, its inherited lane and what catches it', async () => {
    expect(await view('Activity_CheckPolicy')).toMatchObject({
      kind: 'element',
      element: { id: 'Activity_CheckPolicy', kind: 'serviceTask', name: 'Check policy' },
      ancestors: [{ id: 'Process_Claims', kind: 'process' }, { id: 'Activity_Assess', kind: 'subProcess' }],
      pool: { id: 'Participant_Insurer' },
      lane: { id: 'Lane_Office', via: { id: 'Activity_Assess' } },
      from: [{ id: 'Event_AssessStart', flow: { id: 'Flow_ToCheck' } }],
      to: [{ id: 'Activity_RateDamage', flow: { id: 'Flow_ToRate' } }],
      caughtBy: [{ id: 'Event_FraudSuspected', to: [{ id: 'Activity_Investigate' }] }],
      eventSubProcesses: [{ id: 'Activity_OnCancel' }],
      attrs: { 'camunda:topic': 'check-policy' },
      extensions: [{ index: 0, type: 'camunda:inputOutput' }],
    });
  });

  it('names the parents of a nested lane', async () => {
    expect((await view('Activity_SendDecision')).lane).toMatchObject({ id: 'Lane_Clerks', parents: [{ id: 'Lane_Office', name: 'Office' }] });
  });

  it('gives a boundary event its host, and the host its boundary events and children', async () => {
    expect((await view('Event_FraudSuspected')).host).toMatchObject({ id: 'Activity_Assess', nonInterrupting: undefined });
    const host = await view('Activity_Assess');
    expect(host.boundary.map(({ id }) => id)).toEqual(['Event_FraudSuspected']);
    expect(host.children?.map(({ id }) => id)).toEqual(['Event_AssessStart', 'Activity_CheckPolicy', 'Activity_RateDamage', 'Event_AssessEnd']);
  });

  it('gives a sequence flow and a message flow their ends, a message flow with the pool', async () => {
    const flow = await view('Flow_Covered');
    expect([flow.from?.[0]?.id, flow.to?.[0]?.id]).toEqual(['Gateway_Covered', 'Activity_Pay']);
    const message = await view('Flow_Decision');
    expect(message.from).toMatchObject([{ id: 'Activity_SendDecision', pool: { id: 'Participant_Insurer' } }]);
    expect(message.ancestors.map(({ id }) => id)).toEqual(['Collaboration_Claims']);
    expect(message.messageFlows).toEqual([]);
  });

  it('lists the members of a lane and what an annotation hangs on', async () => {
    expect((await view('Lane_Fraud')).members?.map(({ id }) => id)).toContain('Activity_Investigate');
    const note = await view('TextAnnotation_Pay');
    expect(note.attachedTo?.map(({ id }) => id)).toEqual(['Activity_Pay']);
    expect(note.annotations).toEqual([]);
  });

  it('tells a pool from an element with flows, and a task from its data and annotations', async () => {
    const pool = await view('Participant_Customer');
    expect(pool.from).toBeUndefined();
    expect(pool.messageFlows.map(({ id }) => id)).toEqual(['Flow_Claim', 'Flow_Decision']);
    const pay = await view('Activity_Pay');
    expect(pay.annotations).toEqual([{ id: 'TextAnnotation_Pay', text: 'Paid by bank transfer' }]);
    expect(pay.data?.reads?.map(({ id }) => id)).toEqual(['DataObjectReference_ClaimFile']);
  });

  it('prints the same answer as text', async () => {
    const { text } = new ElementDetail(await Fixtures.read('models/views/claims.bpmn')).answer('Activity_Pay');

    expect(text.split('\n')[0]).toBe('serviceTask Activity_Pay "Pay claim"');
  });

  it('refuses an id the file does not hold', async () => {
    const detail = new ElementDetail(await Fixtures.read('models/views/claims.bpmn'));

    expect(() => detail.answer('Pay claim')).toThrow(expect.objectContaining({ code: 'E_NOT_FOUND' }));
  });
});
