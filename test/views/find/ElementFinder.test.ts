import { describe, expect, it } from 'vitest';
import { ElementFinder, type FindOptions } from '../../../src/views/find/ElementFinder.js';
import { Fixtures } from '../../support/Fixtures.js';

const find = async (options: FindOptions, file = 'models/views/claims.bpmn') => new ElementFinder(await Fixtures.read(file), options).answer();
const ids = async (options: FindOptions, file?: string) => (await find(options, file)).hits.map(({ id }) => id);

describe('ElementFinder', () => {
  it('finds by id or name, case-insensitive, and carries the total', async () => {
    const { hits, total, text } = await find({ text: 'PAY CLAIM' });

    expect(hits).toEqual([{ id: 'Activity_Pay', kind: 'serviceTask', name: 'Pay claim', in: 'Lane_Clerks', match: undefined }]);
    expect(total).toBe(1);
    expect(text).toContain('Activity_Pay');
    expect(await ids({ text: 'activity_pay' })).toEqual(['Activity_Pay']);
  });

  it('finds an annotation by its text', async () => {
    expect((await find({ text: 'bank transfer' })).hits).toMatchObject([{ id: 'TextAnnotation_Pay', kind: 'textAnnotation', name: 'Paid by bank transfer' }]);
  });

  it('says which vendor value matched when neither id nor name did', async () => {
    expect((await find({ text: 'check-policy' })).hits).toMatchObject([{ id: 'Activity_CheckPolicy', match: 'camunda:topic=check-policy' }]);
    expect((await find({ text: 'policyId' })).hits).toMatchObject([{ id: 'Activity_CheckPolicy', match: 'camunda:inputParameter name=policyId' }]);
    expect((await find({ text: '${covered}' })).hits[0]).toMatchObject({ id: 'Activity_CheckPolicy', match: 'camunda:outputParameter ${covered}' });
  });

  it('matches a decision link and the extensions of a nested element', async () => {
    expect((await find({ text: 'pick-route' }, 'views/implementation.bpmn')).hits).toMatchObject([{ id: 'Decide', match: 'camunda:decisionRef=pick-route' }]);
    expect((await find({ text: '=items' }, 'views/implementation.bpmn')).hits).toMatchObject([{ id: 'Charge', match: 'loop.zeebe:loopCharacteristics inputCollection==items' }]);
  });

  it('lists every element the filters let through without a text', async () => {
    const all = await ids({});

    expect(all).toContain('Process_Claims');
    expect(all).toContain('Flow_Claim');
    expect(all).toContain('Message_Claim');
    expect(all).not.toContain('Def_Claim');
  });

  it('takes a kind as add writes it, or a family', async () => {
    expect(await ids({ kind: 'serviceTask' })).toEqual(['Activity_CheckPolicy', 'Activity_Pay']);
    expect(await ids({ kind: 'service' })).toEqual(['Activity_CheckPolicy', 'Activity_Pay']);
    expect(await ids({ kind: 'task' })).toEqual(['Activity_CheckPolicy', 'Activity_RateDamage', 'Activity_Pay', 'Activity_SendDecision', 'Activity_Investigate']);
    expect(await ids({ kind: 'gateway' })).toEqual(['Gateway_Covered']);
    expect((await ids({ kind: 'event' })).length).toBe(8);
    expect(await ids({ kind: 'startEvent:message' })).toEqual(['Event_ClaimReceived', 'Event_CancelRequested']);
  });

  it('refuses an unknown kind', async () => {
    await expect(find({ kind: 'bogus' })).rejects.toMatchObject({ code: 'E_USAGE' });
  });

  it('hides event definitions and shows associations only with --kind association', async () => {
    expect(await ids({ text: 'Def_' })).toEqual([]);
    const associations = await ids({ kind: 'association' });
    expect(associations).toHaveLength(2);
    expect(await ids({ text: associations[0]! })).toEqual([]);
    expect(await ids({ kind: 'dataAssociation' })).toHaveLength(2);
  });

  it('finds a loop characteristics element by its id only with a text', async () => {
    expect(await ids({ text: 'Loop_Charge' }, 'views/implementation.bpmn')).toEqual(['Loop_Charge']);
    expect(await ids({}, 'views/implementation.bpmn')).not.toContain('Loop_Charge');
  });

  it('narrows to a pool, process, lane or sub-process', async () => {
    expect(await ids({ kind: 'task', in: 'Lane_Clerks' })).toEqual(['Activity_Pay', 'Activity_SendDecision']);
    expect(await ids({ kind: 'task', in: 'Activity_Assess' })).toEqual(['Activity_CheckPolicy', 'Activity_RateDamage']);
    expect(await ids({ kind: 'gateway', in: 'Participant_Insurer' })).toEqual(['Gateway_Covered']);
    await expect(find({ in: 'Activity_Pay' })).rejects.toMatchObject({ code: 'E_WRONG_KIND' });
  });

  it('places a hit in its innermost lane, sub-process or pool, else its process', async () => {
    const placed = async (id: string, file?: string) => (await find({ text: id }, file)).hits.find((hit) => hit.id === id)?.in;

    expect(await placed('Activity_Pay')).toBe('Lane_Clerks');
    expect(await placed('Activity_CheckPolicy')).toBe('Activity_Assess');
    expect(await placed('Event_FraudSuspected')).toBe('Lane_Office');
    expect(await placed('DataObjectReference_ClaimFile')).toBe('Participant_Insurer');
    expect(await placed('Process_Claims')).toBeUndefined();
    expect(await placed('Flow_Covered')).toBe('Lane_Clerks');
    expect(await placed('Task_1', 'views/long-outline.bpmn')).toBe('Lane_First');
    expect(await placed('Other_Start', 'views/long-outline.bpmn')).toBe('Process_Other');
  });

  it('finds nothing and stays empty', async () => {
    expect(await find({ text: 'no such thing' })).toEqual({ text: '', hits: [], total: 0 });
  });
});
