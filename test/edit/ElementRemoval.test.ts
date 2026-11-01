import { describe, expect, it } from 'vitest';
import { ElementRemoval } from '../../src/edit/ElementRemoval.js';
import { EditSession } from '../../src/edit/session/EditSession.js';
import type { RemoveOperation } from '../../src/operations/index.js';
import { type BpmnElement, ChangeSet } from '../support/ModelValues.js';
import { Fixtures } from '../support/Fixtures.js';

const ORDER = 'edit/order-check.bpmn';
const LANES = 'edit/containers-lanes.bpmn';
const ARTIFACTS = 'edit/containers-artifacts.bpmn';
const POOLS = 'edit/two-pools.bpmn';

function operation(fields: object): RemoveOperation {
  return Fixtures.operations([{ op: 'remove', ...fields }]).model[0] as RemoveOperation;
}

async function remove(path: string, fields: object) {
  const session = new EditSession(await Fixtures.readForWrite(path));
  const changes = new ElementRemoval(session).remove(operation(fields));
  const { tree, scopes, flows } = session.document;
  return { session, changes, tree, flows, laneIds: (id: string) => scopes.lanesOf(tree.require(id)).map((lane) => lane.id) };
}

function ids(changes: ReadonlyArray<{ id: string }>): string[] {
  return changes.map(({ id }) => id);
}

describe('ElementRemoval', () => {
  it('removes a task and bridges the path around it', async () => {
    const { tree, flows, changes } = await remove(ORDER, { ids: ['check'] });

    expect(tree.has('check')).toBe(false);
    expect(ids(changes.removed)).toContain('check');
    expect(flows.outgoing(tree.require('startEvent_orderReceived')).map((flow) => flow.get<BpmnElement>('targetRef').id)).toEqual(['gateway_ok']);
  });

  it('leaves a gap when told not to bridge', async () => {
    const { tree, flows } = await remove(ORDER, { ids: ['check'], bridge: 'none' });

    expect(flows.outgoing(tree.require('startEvent_orderReceived'))).toEqual([]);
  });

  it('removes a sequence flow on its own', async () => {
    const { tree, changes } = await remove(ORDER, { ids: ['flow_checkToOk'] });

    expect(tree.has('flow_checkToOk')).toBe(false);
    expect(tree.require('check').list('outgoing')).toEqual([]);
    expect(changes.removed).toEqual([expect.objectContaining({ id: 'flow_checkToOk', kind: 'sequenceFlow' })]);
  });

  it('reports what a removed sub-process held, its flows too', async () => {
    const { tree, changes } = await remove('edit/sub-process.bpmn', { ids: ['Sub'] });

    expect(tree.has('Sub_task')).toBe(false);
    expect(ids(changes.removed)).toEqual(expect.arrayContaining(['Sub', 'Sub_start', 'Sub_task', 'flow_subStartToTask']));
  });

  it('refuses an unknown id unless told it may be gone', async () => {
    await expect(remove(ORDER, { ids: ['nobody'] })).rejects.toMatchObject({ code: 'E_NOT_FOUND' });
    expect((await remove(ORDER, { ids: ['nobody'], ifExists: true })).changes.notes).toEqual(['nobody does not exist; skipped']);
  });

  it('refuses to remove the definitions, for that is the file', async () => {
    await expect(remove(ORDER, { ids: ['Definitions_orderCheck'] })).rejects.toMatchObject({ code: 'E_INVALID_REMOVE' });
  });

  it('notes an id that went with an earlier one of the list', async () => {
    const { changes } = await remove('edit/sub-process.bpmn', { ids: ['Sub', 'Sub_task'] });

    expect(changes.notes).toContain('Sub_task was already removed together with an earlier element');
  });

  it('removes a branch up to the join other paths reach', async () => {
    const { tree, changes } = await remove(ORDER, { ids: ['reject'], withBranch: true });

    expect(tree.has('reject')).toBe(false);
    expect(tree.has('gateway_join')).toBe(true);
    expect(changes.notes[0]).toBe('branch of reject: 1 node(s) (reject); it stops before gateway_join, which other paths reach (they stay)');
  });

  it('removes a branch to its end and says so', async () => {
    const { tree, changes } = await remove(ORDER, { ids: ['gateway_ok'], withBranch: true });

    expect(tree.has('endEvent_done')).toBe(false);
    expect(changes.notes[0]).toContain('; it ends there');
    expect(ids(changes.removed)).toEqual(expect.arrayContaining(['ship', 'reject', 'gateway_join']));
  });

  it('takes a node of two listed branches once and skips what is gone', async () => {
    const { changes } = await remove(ORDER, { ids: ['gateway_ok', 'ship', 'nobody'], withBranch: true, ifExists: true });

    expect(changes.notes).toContain('nobody does not exist; skipped');
    expect(ids(changes.removed).filter((id) => id === 'ship')).toEqual(['ship']);
  });

  it('takes a boundary event with its host when a branch reaches both', async () => {
    const { tree, changes } = await remove(ARTIFACTS, { ids: ['write'], withBranch: true });

    expect(tree.has('compensate_write')).toBe(false);
    expect(tree.has('undo_write')).toBe(false);
    expect(ids(changes.removed).filter((id) => id === 'compensate_write')).toEqual(['compensate_write']);
  });

  it('refuses a branch of an id that does not exist', async () => {
    await expect(remove(ORDER, { ids: ['nobody'], withBranch: true })).rejects.toMatchObject({ code: 'E_NOT_FOUND' });
  });

  it.each([
    ['all', '--bridge-all'],
    ['none', '--no-bridge'],
  ])('refuses a bridge of kind %s beside a removed branch', async (bridge, flag) => {
    await expect(remove(ORDER, { ids: ['reject'], withBranch: true, bridge })).rejects.toMatchObject({ code: 'E_USAGE', message: expect.stringContaining(`drop ${flag}`) });
  });

  it('hands the members of a removed lane to the lane above it', async () => {
    const { tree, changes, laneIds } = await remove(POOLS, { ids: ['lane_stock'] });

    expect(tree.has('lane_stock')).toBe(false);
    expect(laneIds('ship')).toEqual(['lane_sales']);
    expect(changes.notes).toContain('2 member(s) of lane_stock moved to lane_sales');
    expect(ids(changes.removed)).toEqual(['lane_stock']);
  });

  it('hands the members of the first lane to the lane below it', async () => {
    const { laneIds } = await remove(POOLS, { ids: ['lane_sales'] });

    expect(laneIds('pack')).toEqual(['lane_stock']);
  });

  it('hands members to the neighbouring leaf of a nested lane, the last child to its parent', async () => {
    const first = await remove(LANES, { ids: ['lane_inbound'] });
    expect(first.laneIds('pack')).toEqual(['lane_outbound']);

    const session = new EditSession(first.session.document);
    new ElementRemoval(session).remove(operation({ ids: ['lane_outbound'] }));

    expect(first.tree.require('lane_ops').get<BpmnElement>('childLaneSet')).toBeUndefined();
    expect(first.laneIds('pack')).toEqual(['lane_ops']);
  });

  it('hands the members of a lane with child lanes to the leaf next to it', async () => {
    expect((await remove(LANES, { ids: ['lane_ops'] })).laneIds('ship')).toEqual(['lane_sales']);
    expect((await remove(LANES, { ids: ['lane_sales'] })).laneIds('check')).toEqual(['lane_inbound']);
  });

  it('frees a last lane and an empty lane without a handover', async () => {
    const last = await remove(LANES, { ids: ['lane_other'] });
    const empty = await remove(LANES, { ids: ['lane_idle'] });

    expect(last.laneIds('other_task')).toEqual([]);
    expect(last.tree.require('Process_other').list('laneSets')).toEqual([]);
    expect(empty.changes.notes).toEqual([]);
  });

  it('removes a pool with its process and message flows, and keeps the collaboration of the others', async () => {
    const { tree, changes } = await remove(POOLS, { ids: ['participant_customer'] });

    expect(tree.has('Process_customer')).toBe(false);
    expect(tree.has('flow_orderToReceive')).toBe(false);
    expect(tree.collaboration()?.id).toBe('Collaboration_shop');
    expect(ids(changes.removed)).toEqual(expect.arrayContaining(['participant_customer', 'Process_customer', 'send_order']));
  });

  it('keeps a process another pool still shows', async () => {
    const { tree } = await remove('edit/containers-shared-process.bpmn', { ids: ['pool_first'] });

    expect(tree.has('Process_shared')).toBe(true);
    expect(tree.has('pool_second')).toBe(true);
  });

  it('keeps an empty process when the last pool is removed, so the file stays editable', async () => {
    const { tree, changes } = await remove('edit/containers-one-pool.bpmn', { ids: ['pool_only'] });
    const [process] = tree.processes();

    expect(tree.collaboration()).toBeUndefined();
    expect(tree.processes()).toHaveLength(1);
    expect(process?.name).toBe('Only process');
    expect(process?.get('isExecutable')).toBe(true);
    expect(process?.list('flowElements')).toEqual([]);
    expect(tree.definitions.list('rootElements').indexOf(process!)).toBe(1);
    expect(changes.created).toEqual([expect.objectContaining({ id: process?.id, kind: 'process', detail: 'empty process: the last pool was removed (executable)' })]);
    expect(changes.notes.some((note) => note.includes('collaboration Collaboration_one removed'))).toBe(true);
  });

  it('keeps an empty process that does not run when the last pool was a black box', async () => {
    const { tree, changes } = await remove('edit/containers-black-box.bpmn', { ids: ['pool_box'] });
    const [process] = tree.processes();

    expect(process?.name).toBe('Bank');
    expect(process?.get('isExecutable')).toBe(false);
    expect(changes.created[0]?.detail).toBe('empty process: the last pool was removed (not executable)');
  });

  it('turns no pool into anything when its process is removed first', async () => {
    const { tree, changes } = await remove(LANES, { ids: ['Process_other'] });

    expect(tree.has('pool_other')).toBe(true);
    expect(changes.warnings.map(({ code }) => code)).toEqual(['W_BLACK_BOX']);
    expect(ids(changes.removed)).toContain('other_task');
  });

  it('cascades over a data association, which has an id but is no flow element', async () => {
    const { session } = await remove(ARTIFACTS, { ids: ['read'] });
    const changes = new ChangeSet();

    new ElementRemoval(session).cascade(session.require('output_archive'), changes);

    expect(changes.removed).toEqual([expect.objectContaining({ id: 'output_archive' })]);
    expect(session.require('write').list('dataOutputAssociations')).toEqual([]);
  });

  it('reports a removed property even though it is no flow element', async () => {
    const session = new EditSession(await Fixtures.readForWrite(ARTIFACTS));
    const changes = new ChangeSet();

    new ElementRemoval(session).cascade(session.require('property_kept'), changes);

    expect(ids(changes.removed)).toEqual(['property_kept']);
  });

  it('does nothing for an element that is gone already', async () => {
    const session = new EditSession(await Fixtures.readForWrite(ORDER));
    const removal = new ElementRemoval(session);
    const changes = new ChangeSet();
    const task = session.require('ship');

    removal.cascade(task, changes);
    const removedOnce = changes.removed.length;
    removal.cascade(task, changes);

    expect(changes.removed).toHaveLength(removedOnce);
  });
});
