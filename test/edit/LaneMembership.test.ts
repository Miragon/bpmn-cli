import { describe, expect, it } from 'vitest';
import { LaneMembership } from '../../src/edit/LaneMembership.js';
import { EditSession } from '../../src/edit/session/EditSession.js';
import type { AddOperation } from '../../src/operations/index.js';
import { type BpmnElement, ChangeSet } from '../support/ModelValues.js';
import { Fixtures } from '../support/Fixtures.js';

const ORDER = 'edit/order-check.bpmn';
const LANES = 'edit/containers-lanes.bpmn';
const POOLS = 'edit/two-pools.bpmn';

function laneOperation(fields: object): AddOperation {
  return Fixtures.operations([{ op: 'add', kind: 'lane', ...fields }]).model[0] as AddOperation;
}

async function setUp(path: string) {
  const session = new EditSession(await Fixtures.readForWrite(path));
  const lanes = new LaneMembership(session);
  const changes = new ChangeSet();
  return { session, lanes, changes, memberIds: (id: string) => session.require(id).list('flowNodeRef').map((node) => node.id) };
}

describe('LaneMembership', () => {
  it('gives the first lane of a process all its flow nodes, later lanes none', async () => {
    const { lanes, changes, memberIds, session } = await setUp(ORDER);

    const first = lanes.createLane(laneOperation({ name: 'Sales' }), changes);
    const second = lanes.createLane(laneOperation({ name: 'Billing' }), new ChangeSet());

    expect(memberIds(first.id)).toEqual(session.document.scopes.flowNodes(session.require('Process_orderCheck')).map(({ id }) => id));
    expect(changes.notes).toContain(`moved 7 member(s) of Process_orderCheck into its first lane ${first.id}`);
    expect(memberIds(second.id)).toEqual([]);
  });

  it('creates the lane set the first lane needs and names the process in the report', async () => {
    const { lanes, changes, session } = await setUp(ORDER);

    const lane = lanes.createLane(laneOperation({ id: 'lane_mine' }), changes);

    expect(lane.parent?.parent).toBe(session.require('Process_orderCheck'));
    expect(changes.created[0]).toEqual({ id: 'lane_mine', kind: 'lane', detail: 'in Process_orderCheck' });
    expect(changes.notes[0]).toBe(`created laneSet ${lane.parent?.id} in Process_orderCheck`);
  });

  it('warns that lanes without a pool are not drawn', async () => {
    const { lanes, changes } = await setUp(ORDER);

    const lane = lanes.createLane(laneOperation({}), changes);

    expect(changes.warnings[0]).toMatchObject({ code: 'W_LANES_WITHOUT_POOL', element: lane.id });
  });

  it('adds a lane to a pool without a warning and keeps the members the first lane holds', async () => {
    const { lanes, changes, memberIds } = await setUp(POOLS);

    const lane = lanes.createLane(laneOperation({ name: 'Returns', in: 'participant_shop' }), changes);

    expect(changes.warnings).toEqual([]);
    expect(memberIds(lane.id)).toEqual([]);
    expect(memberIds('lane_sales')).toEqual(['receive_order', 'pack']);
  });

  it('moves the named members of a later lane out of their lanes', async () => {
    const { lanes, changes, memberIds } = await setUp(POOLS);

    const lane = lanes.createLane(laneOperation({ name: 'Returns', in: 'participant_shop', members: ['pack'] }), changes);

    expect(memberIds(lane.id)).toEqual(['pack']);
    expect(memberIds('lane_sales')).toEqual(['receive_order']);
    expect(changes.changed).toEqual([expect.objectContaining({ id: 'pack', detail: `lane ${lane.id}` })]);
  });

  it('warns that a first lane got more than the members it named', async () => {
    const { lanes, changes, memberIds } = await setUp(ORDER);

    const lane = lanes.createLane(laneOperation({ name: 'Sales', members: ['check', 'ship'] }), changes);

    expect(memberIds(lane.id)).toHaveLength(7);
    expect(changes.warnings.map(({ code }) => code)).toEqual(['W_LANES_WITHOUT_POOL', 'W_OPTION_IGNORED']);
    expect(changes.warnings[1]?.related).toEqual(['startEvent_orderReceived', 'gateway_ok', 'reject', 'gateway_join', 'endEvent_done']);
    expect(changes.warnings[1]?.message).toContain('because the first lane covers the whole pool');
  });

  it('nests the first child lane and hands it the members of its parent', async () => {
    const { lanes, changes, memberIds, session } = await setUp(POOLS);

    const child = lanes.createLane(laneOperation({ name: 'Inbox', in: 'lane_sales' }), changes);

    expect(session.require('lane_sales').get<BpmnElement>('childLaneSet').list('lanes')).toEqual([child]);
    expect(memberIds(child.id)).toEqual(['receive_order', 'pack']);
    expect(memberIds('lane_sales')).toEqual([]);
    expect(changes.created[0]?.detail).toBe('in lane lane_sales');
    expect(changes.notes.join()).toContain('moved 2 member(s) of lane_sales into its first child lane');
  });

  it('warns that a first child lane got all of its parent', async () => {
    const { lanes, changes, memberIds } = await setUp(POOLS);

    const child = lanes.createLane(laneOperation({ name: 'Inbox', in: 'lane_sales', members: ['pack'] }), changes);

    expect(memberIds(child.id)).toEqual(['receive_order', 'pack']);
    expect(changes.warnings[0]?.message).toContain('because a lane with child lanes has no direct members');
  });

  it('adds a further child lane to the child lane set the parent has', async () => {
    const { lanes, changes, memberIds, session } = await setUp(LANES);

    const child = lanes.createLane(laneOperation({ name: 'Returns', in: 'lane_ops' }), changes);

    expect(child.parent?.id).toBe('LaneSet_ops');
    expect(session.require('lane_ops').get<BpmnElement>('childLaneSet').list('lanes')).toHaveLength(3);
    expect(memberIds(child.id)).toEqual([]);
  });

  it('notes nothing for a first lane of an empty parent', async () => {
    const { lanes, changes } = await setUp(LANES);

    lanes.createLane(laneOperation({ name: 'Nobody', in: 'lane_idle' }), changes);

    expect(changes.notes.filter((note) => note.startsWith('moved'))).toEqual([]);
  });

  it('refuses a lane inside a sub-process', async () => {
    const { lanes, changes } = await setUp(LANES);

    expect(() => lanes.createLane(laneOperation({ in: 'sub_handle' }), changes)).toThrow(expect.objectContaining({ code: 'E_INVALID_SCOPE', details: expect.objectContaining({ element: 'sub_handle' }) }));
  });

  it('refuses a lane in a black box and in anything that holds no lanes', async () => {
    const { lanes, changes } = await setUp(LANES);

    expect(() => lanes.createLane(laneOperation({ in: 'pool_blackBox' }), changes)).toThrow(expect.objectContaining({ code: 'E_BLACK_BOX' }));
    expect(() => lanes.createLane(laneOperation({ in: 'pack' }), changes)).toThrow(expect.objectContaining({ code: 'E_WRONG_KIND' }));
  });

  it('moves a node between lanes and its boundary events with it', async () => {
    const { lanes, changes, session, memberIds } = await setUp(LANES);

    lanes.assign(session.require('check'), session.require('lane_idle'), changes);

    expect(memberIds('lane_idle')).toEqual(['check', 'timer_check']);
    expect(memberIds('lane_sales')).toEqual(['start_order', 'gateway_route', 'sub_handle']);
    expect(changes.changed.map(({ id, detail }) => [id, detail])).toEqual([['check', 'lane lane_idle'], ['timer_check', 'lane lane_idle']]);
  });

  it('leaves a node where it is when it is in that lane already', async () => {
    const { lanes, changes, session } = await setUp(LANES);

    lanes.assign(session.require('pack'), session.require('lane_inbound'), changes);

    expect(changes.changed).toEqual([]);
  });

  it('takes a node out of its lanes, and reports it once', async () => {
    const { lanes, changes, session, memberIds } = await setUp(LANES);
    const pack = session.require('pack');

    lanes.assign(pack, undefined, changes);
    lanes.assign(pack, undefined, changes);

    expect(memberIds('lane_inbound')).toEqual([]);
    expect(changes.changed).toEqual([expect.objectContaining({ id: 'pack', name: 'Pack', detail: 'removed from lanes' })]);
  });

  it('refuses a lane that is none, of another process, or has child lanes', async () => {
    const { lanes, changes, session } = await setUp(LANES);
    const pack = session.require('pack');

    expect(() => lanes.assign(pack, session.require('ship'), changes)).toThrow(expect.objectContaining({ code: 'E_WRONG_KIND', details: expect.objectContaining({ element: 'ship' }) }));
    expect(() => lanes.assign(pack, session.require('lane_other'), changes)).toThrow(expect.objectContaining({ code: 'E_INVALID_LANE_MEMBERSHIP', details: expect.objectContaining({ related: ['lane_other'] }) }));
    expect(() => lanes.assign(pack, session.require('lane_ops'), changes)).toThrow(expect.objectContaining({ code: 'E_INVALID_LANE_MEMBERSHIP', details: expect.objectContaining({ candidates: ['lane_inbound', 'lane_outbound'] }) }));
  });

  it('refuses what cannot be a lane member: no flow node, or a node inside a sub-process', async () => {
    const { lanes, changes, session } = await setUp(LANES);
    const lane = session.require('lane_idle');

    expect(() => lanes.assign(session.require('flow_packToShip'), lane, changes)).toThrow(expect.objectContaining({ code: 'E_INVALID_LANE_MEMBERSHIP', message: expect.stringContaining('only flow nodes can be lane members') }));
    expect(() => lanes.assign(session.require('sub_task'), lane, changes)).toThrow(expect.objectContaining({ code: 'E_INVALID_LANE_MEMBERSHIP', message: expect.stringContaining('inside sub-process sub_handle') }));
  });
});
