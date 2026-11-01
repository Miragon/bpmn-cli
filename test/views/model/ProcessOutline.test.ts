import { describe, expect, it } from 'vitest';
import { ProcessOutline, type ViewNode } from '../../../src/views/model/ProcessOutline.js';
import { Fixtures } from '../../support/Fixtures.js';

const outline = async (file = 'models/views/claims.bpmn', id = 'Process_Claims') => {
  const document = await Fixtures.read(file);
  return new ProcessOutline(document).process(document.tree.require(id));
};
const node = (nodes: readonly ViewNode[], id: string): ViewNode | undefined => nodes.flatMap((candidate) => (candidate.id === id ? [candidate] : [node(candidate.children ?? [], id), node(candidate.boundary ?? [], id)].filter((found): found is ViewNode => !!found)))[0];

describe('ProcessOutline', () => {
  it('lists nodes in flow order, unreachable ones last and marked', async () => {
    const { nodes } = await outline();

    expect(nodes.map(({ id }) => id).slice(0, 3)).toEqual(['Event_ClaimReceived', 'Activity_Assess', 'Gateway_Covered']);
    const { nodes: drawn } = await outline('views/groups.bpmn', 'Process_Groups');
    expect(drawn.at(-1)).toMatchObject({ id: 'Stray', unreachable: true });
  });

  it('shows the flows of a file that leaves out the optional incoming and outgoing entries', async () => {
    const { nodes } = await outline('views/implementation.bpmn', 'Process_Implementation');

    expect(node(nodes, 'Charge')?.outgoing.map(({ id }) => id)).toEqual(['Flow_Resource']);
    expect(node(nodes, 'Review')?.incoming.map(({ id }) => id)).toEqual(['Flow_Resource']);
  });

  it('nests boundary events and children under their host', async () => {
    const assess = node((await outline()).nodes, 'Activity_Assess');

    expect(assess?.boundary?.map(({ id }) => id)).toEqual(['Event_FraudSuspected']);
    expect(assess?.children?.map(({ id }) => id)).toEqual(['Event_AssessStart', 'Activity_CheckPolicy', 'Activity_RateDamage', 'Event_AssessEnd']);
    expect(assess?.expanded).toBe(true);
  });

  it('gives every reference as id, kind and name', async () => {
    const pay = node((await outline()).nodes, 'Activity_Pay');

    expect(pay?.lane).toEqual({ id: 'Lane_Clerks', kind: 'lane', name: 'Clerks' });
    expect(pay?.incoming[0]).toEqual({ id: 'Flow_Covered', kind: 'sequenceFlow', name: 'yes' });
    expect(pay?.outgoing[0]?.target).toEqual({ id: 'Activity_SendDecision', kind: 'sendTask', name: 'Send decision' });
  });

  it('keeps the lane tree, data and annotations of the process', async () => {
    const { lanes, data, annotations, participant, executable } = await outline();

    expect(lanes.map(({ id }) => id)).toEqual(['Lane_Office', 'Lane_Fraud']);
    expect(lanes[0]?.lanes?.map(({ id }) => id)).toEqual(['Lane_Clerks']);
    expect(data).toMatchObject([{ id: 'DataObjectReference_ClaimFile', from: [{ id: 'Activity_RateDamage' }], to: [{ id: 'Activity_Pay' }] }]);
    expect(annotations.map(({ id }) => id)).toEqual(['TextAnnotation_Pay']);
    expect(participant?.id).toBe('Participant_Insurer');
    expect(executable).toBe(true);
  });

  it('sizes a node list with everything nested in it', async () => {
    expect(ProcessOutline.sizeOf((await outline()).nodes)).toEqual({ nodes: 16, flows: 12 });
    expect(ProcessOutline.sizeOf([])).toEqual({ nodes: 0, flows: 0 });
  });

  it('reads a collapsed sub-process as collapsed', async () => {
    const document = await Fixtures.read('models/render/gallery.bpmn');
    const outlined = new ProcessOutline(document);

    expect(outlined.expanded(document.tree.require('Activity_CollapsedSubProcess'))).toBe(false);
    expect(outlined.expanded(document.tree.require('Activity_ExpandedSubProcess'))).toBe(true);
  });

  it('heads a process without its nodes', async () => {
    const document = await Fixtures.read('models/views/claims.bpmn');

    expect(ProcessOutline.headerOf(document, document.tree.require('Process_Claims'))).toMatchObject({ id: 'Process_Claims', attrs: { 'camunda:historyTimeToLive': '180' } });
  });
});
