import { describe, expect, it } from 'vitest';
import { ModelView } from '../../../src/views/model/ModelView.js';
import { OutlineCut } from '../../../src/views/model/OutlineCut.js';
import { Fixtures } from '../../support/Fixtures.js';

const cut = async (id: string, file = 'models/views/claims.bpmn') => {
  const document = await Fixtures.read(file);
  return new OutlineCut(document, id).of(new ModelView(document).answer().view);
};

describe('OutlineCut', () => {
  it('keeps a whole process for a pool, with only its own participant', async () => {
    const view = await cut('Participant_Insurer');

    expect(view.cut).toMatchObject({ in: { id: 'Process_Claims' }, nodes: { shown: 16, total: 16 }, flows: { shown: 12, total: 12 } });
    expect(view.collaboration?.participants.map(({ id }) => id)).toEqual(['Participant_Insurer']);
    expect(view.processes[0]?.lanes).toHaveLength(2);
  });

  it('keeps a sub-process with its boundary event, and what touches it', async () => {
    const view = await cut('Activity_Assess');
    const [process] = view.processes;

    expect(process?.nodes.map(({ id }) => id)).toEqual(['Activity_Assess']);
    expect(view.cut?.nodes).toEqual({ shown: 6, total: 16 });
    expect(process?.lanes).toEqual([]);
    expect(process?.data.map(({ id }) => id)).toEqual(['DataObjectReference_ClaimFile']);
    expect(process?.annotations).toEqual([]);
    expect(view.collaboration?.messageFlows).toEqual([]);
    expect(view.collaboration?.annotations).toEqual([]);
  });

  it('keeps a lane with the nodes of its nested lanes and its part of the lane tree', async () => {
    const view = await cut('Lane_Fraud');
    const [process] = view.processes;

    expect(process?.nodes.map(({ id }) => id)).toEqual(['Activity_Investigate', 'Event_Closed', 'Activity_OnCancel']);
    expect(process?.lanes.map(({ id }) => id)).toEqual(['Lane_Fraud']);
    expect(view.cut?.nodes).toEqual({ shown: 5, total: 16 });

    const nested = await cut('Lane_Clerks');
    expect(nested.processes[0]?.lanes.map(({ id }) => id)).toEqual(['Lane_Clerks']);
    expect(nested.collaboration?.messageFlows.map(({ id }) => id)).toEqual(['Flow_Decision']);
  });

  it('keeps only the groups of the part', async () => {
    const whole = new ModelView(await Fixtures.read('models/incremental/groups.bpmn')).answer().view;
    const [process] = whole.processes;
    const view = await cut(process!.id, 'models/incremental/groups.bpmn');

    expect(view.groups?.length).toBe(whole.groups?.length);
  });

  it('refuses an id that is no container', async () => {
    await expect(cut('Activity_Pay')).rejects.toMatchObject({ code: 'E_WRONG_KIND' });
  });
});
