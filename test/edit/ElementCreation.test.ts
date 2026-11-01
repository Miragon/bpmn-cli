import { describe, expect, it } from 'vitest';
import { ElementCreation } from '../../src/edit/ElementCreation.js';
import { EditSession } from '../../src/edit/session/EditSession.js';
import type { BpmnDocument, BpmnElement } from '../../src/model/index.js';
import type { AddOperation } from '../../src/operations/index.js';
import { Fixtures } from '../support/Fixtures.js';

type Addition = Omit<AddOperation, 'op'>;

const added = (document: BpmnDocument, operation: Addition, platform?: 'c7' | 'c8') => new ElementCreation(new EditSession(document, platform)).add({ op: 'add', ...operation });

const order = () => Fixtures.readForWrite('edit/order-check.bpmn');

const pools = () => Fixtures.readForWrite('edit/two-pools.bpmn');

const IN_ORDER_CHECK = { in: 'Process_orderCheck' };

function ends(flow: BpmnElement): string {
  return `${flow.get<BpmnElement>('sourceRef').id}->${flow.get<BpmnElement>('targetRef').id}`;
}

describe('ElementCreation', () => {
  it('splices a task after a node with one way out', async () => {
    const document = await order();

    const changes = added(document, { kind: 'userTask', name: 'Do more', after: 'ship' });

    expect(changes.created[0]).toMatchObject({ id: 'userTask_doMore', kind: 'userTask', name: 'Do more', detail: 'after ship' });
    expect(document.flows.incoming(document.tree.require('userTask_doMore')).map(ends)).toEqual(['ship->userTask_doMore']);
    expect(changes.notes.join()).toContain('inserted between ship and gateway_join');
  });

  it('names a node after its kind and anchor, and suffixes a taken id with a warning', async () => {
    const document = await order();

    expect(added(document, { kind: 'parallelGateway', after: 'ship' }).created[0]?.id).toBe('gateway_afterShip');
    expect(added(document, { kind: 'task', name: 'Same', ...IN_ORDER_CHECK }).created[0]?.id).toBe('task_same');
    const second = added(document, { kind: 'task', name: 'Same', ...IN_ORDER_CHECK });
    expect(second.created[0]?.id).toBe('task_same2');
    expect(second.warnings.map(({ code }) => code)).toEqual(['W_ID_SUFFIXED']);
    expect(new ElementCreation(new EditSession(document)).add({ op: 'add', kind: 'exclusiveGateway', ...IN_ORDER_CHECK }, { context: 'Review', anchorKind: 'task' }).created[0]?.id).toBe('gateway_review');
  });

  it.each([
    ['an id in use', { kind: 'task', id: 'check', ...IN_ORDER_CHECK }, 'E_DUPLICATE_ID'],
    ['an id XML cannot hold', { kind: 'task', id: '1bad', ...IN_ORDER_CHECK }, 'E_INVALID_ID'],
    ['an unknown kind', { kind: 'userTsk' }, 'E_UNKNOWN_KIND'],
    ['a kind BPMN has and we do not edit', { kind: 'choreographyTask' }, 'E_UNSUPPORTED_KIND'],
    ['a trigger on a task', { kind: 'userTask:timer' }, 'E_INVALID_TRIGGER'],
    ['a trigger an event sub-process cannot start with', { kind: 'eventSubProcess:terminate' }, 'E_INVALID_TRIGGER'],
    ['a boundary event without a trigger', { kind: 'boundaryEvent', on: 'check' }, 'E_TRIGGER_REQUIRED'],
    ['a condition without text', { kind: 'task', after: 'gateway_ok', condition: '  ' }, 'E_INVALID_VALUE'],
    ['a condition behind a parallel gateway', { kind: 'task', after: 'gateway_fork', condition: '${ok}' }, 'E_INVALID_VALUE', 'model/gateways.bpmn'],
    ['a start event without a trigger inside an event sub-process', { kind: 'startEvent', in: 'cancelOrder' }, 'E_TRIGGER_REQUIRED', 'edit/event-sub-host.bpmn'],
    ['a placement on a pool', { kind: 'participant', name: 'Bank', after: 'pack' }, 'E_INVALID_PLACEMENT', 'edit/two-pools.bpmn'],
    ['a lane behind a node', { kind: 'lane', name: 'Returns', after: 'pack' }, 'E_INVALID_PLACEMENT', 'edit/two-pools.bpmn'],
    ['a group behind a node', { kind: 'group', after: 'check' }, 'E_INVALID_PLACEMENT'],
  ])('refuses %s', async (_case, operation, code, path = 'edit/order-check.bpmn') => {
    await expect(Fixtures.readForWrite(path).then((document) => added(document, operation))).rejects.toMatchObject({ code });
  });

  it('refuses a boundary event on an event sub-process and adds nothing', async () => {
    const document = await Fixtures.readForWrite('edit/event-sub-host.bpmn');

    expect(() => added(document, { kind: 'boundaryEvent:timer', id: 'boundary_new', on: 'cancelOrder', set: { timer: 'PT1H' } })).toThrow(expect.objectContaining({ code: 'E_INVALID_HOST', message: expect.stringContaining('event sub-process') }));
    expect(document.tree.has('boundary_new')).toBe(false);
  });

  it('leaves an element that exists alone when asked to add it only if absent', async () => {
    const document = await order();

    const changes = added(document, { kind: 'userTask', id: 'check', ifAbsent: true, as: '$check', flowAs: '$in', outAs: '$out' });

    expect(changes.notes).toEqual(['check already exists (userTask); nothing to do']);
    expect(changes.created).toEqual([]);
    expect(changes.warnings).toEqual([]);
    expect(changes.bindings.map(({ alias, el }) => [alias, el.id])).toEqual([['$check', 'check'], ['$in', 'flow_receivedToCheck'], ['$out', 'flow_checkToOk']]);
  });

  it('warns when the element that exists has another kind, and adds one that does not exist', async () => {
    const document = await order();

    expect(added(document, { kind: 'serviceTask', id: 'check', ifAbsent: true }).warnings.map(({ code }) => code)).toEqual(['W_KIND_MISMATCH']);
    expect(added(document, { kind: 'task', id: 'task_new', ifAbsent: true, ...IN_ORDER_CHECK }).created[0]?.id).toBe('task_new');
  });

  it('adds a pool, and a process of its own gets what a new process needs', async () => {
    const document = await Fixtures.readForWrite('model/c7-vendor.bpmn');

    added(document, { kind: 'participant', name: 'Bank' }, 'c7');
    const second = added(document, { kind: 'participant', name: 'Partner' }, 'c7');

    const created = second.created.map(({ kind }) => kind);
    expect(created).toContain('participant');
    expect(document.tree.processes().at(-1)?.attrs['camunda:historyTimeToLive']).toBeDefined();
  });

  it('adds a lane to a pool, and a group around the members it is given', async () => {
    expect(added(await pools(), { kind: 'lane', name: 'Returns', in: 'participant_shop' }).created[0]).toMatchObject({ kind: 'lane' });
    expect(added(await order(), { kind: 'group', name: 'Payment', members: ['check', 'ship'] }).created[0]).toMatchObject({ kind: 'group' });
  });

  it('adds a data object, wires it to a task, and warns that it cannot be a lane member', async () => {
    const document = await pools();

    const changes = added(document, { kind: 'dataObject', name: 'Invoice', in: 'Process_shop', to: 'pack', lane: 'lane_sales', set: { doc: 'The bill' } });

    const reference = document.tree.require(changes.created[0]!.id);
    expect(reference.list('documentation')[0]?.get('text')).toBe('The bill');
    expect(document.tree.require('pack').list('dataInputAssociations')).toHaveLength(1);
    expect(changes.warnings.map(({ code }) => code)).toEqual(['W_OPTION_IGNORED']);
    expect(added(document, { kind: 'dataStore', name: 'Stock', in: 'Process_shop' }).created.map(({ kind }) => kind)).toContain('dataStore');
  });

  it('adds a note with its text and links it to the element it explains', async () => {
    const document = await order();

    const changes = added(document, { kind: 'textAnnotation', name: 'Review note', to: 'check', set: { text: 'Above 10k needs approval' } });

    expect(changes.created[0]).toMatchObject({ id: 'textAnnotation_reviewNote', kind: 'textAnnotation' });
    expect(document.tree.require('textAnnotation_reviewNote').get('text')).toBe('Above 10k needs approval');
    expect(changes.created.map(({ kind }) => kind)).toContain('association');
    added(document, { kind: 'textAnnotation', name: 'Short' });
    expect(document.tree.require('textAnnotation_short').get('text')).toBe('Short');
  });

  it('hands the keys it does not know itself to the property editor, and binds the aliases', async () => {
    const document = await order();

    const changes = added(document, { kind: 'callActivity', name: 'Bill', after: 'ship', as: '$bill', set: { calledElement: 'billing' } });

    expect(document.tree.require('callActivity_bill').get('calledElement')).toBe('billing');
    expect(changes.bindings.map(({ alias }) => alias)).toEqual(['$bill']);
  });

  it('creates the root message of a catching event and reports it', async () => {
    const document = await order();

    const changes = added(document, { kind: 'intermediateCatchEvent:message', name: 'Paid', after: 'ship', refAs: '$paid', set: { message: 'Paid' } });

    expect(changes.created.map(({ kind, detail }) => [kind, detail])).toContainEqual(['message', 'root element']);
    expect(changes.created[0]?.kind).toBe('intermediateCatchEvent:message');
    expect(changes.bindings.map(({ alias }) => alias)).toEqual(['$paid']);
    expect(added(document, { kind: 'boundaryEvent', on: 'check', set: { timer: 'P2D' } }).created[0]?.kind).toBe('boundaryEvent:timer');
  });

  it('gives a send task the message it names', async () => {
    const document = await order();

    added(document, { kind: 'sendTask', name: 'Notify', after: 'ship', set: { message: 'Shipped' } });

    expect(document.tree.require('sendTask_notify').get<BpmnElement>('messageRef').get('name')).toBe('Shipped');
  });

  it('makes a user task a Camunda user task on Camunda 8, and says so', async () => {
    const changes = added(await order(), { kind: 'userTask', name: 'Review', after: 'check' }, 'c8');

    expect(changes.notes.join()).toContain('userTask_review is a Camunda user task');
  });

  it('records how a sub-process should be drawn, and notes a collapsed one', async () => {
    const document = await order();

    const collapsed = added(document, { kind: 'subProcess', name: 'Details', after: 'ship', set: { expanded: 'false', doc: 'Explains it' } });
    const expanded = added(document, { kind: 'subProcess', name: 'Open', after: 'check', set: { expanded: 'true' } });

    expect(collapsed.notes).toContain('subProcess_details will be laid out collapsed');
    expect(expanded.notes.join()).not.toContain('collapsed');
    expect(document.tree.require('subProcess_details').list('documentation')[0]?.get('text')).toBe('Explains it');
  });

  it('creates the start event inside an event sub-process in the same step', async () => {
    const document = await order();

    const changes = added(document, { kind: 'eventSubProcess', name: 'Handle errors', set: { error: 'PaymentFailed', errorCode: 'PAY-1' } });

    expect(changes.created.map(({ id, kind }) => [id, kind])).toEqual([
      ['subProcess_handleErrors', 'eventSubProcess'],
      ['startEvent_errorInHandleErrors', 'startEvent:error'],
      ['error_paymentFailed', 'error'],
    ]);
    expect(changes.created[1]?.detail).toBe('start of event sub-process subProcess_handleErrors');
    expect(document.tree.require('subProcess_handleErrors').get('triggeredByEvent')).toBe(true);
    added(document, { kind: 'eventSubProcess', name: 'Empty' });
    expect(document.tree.require('subProcess_empty').list('flowElements')).toEqual([]);
  });

  it('puts a node into the lane it is told, and refuses a lane inside a sub-process', async () => {
    const document = await pools();

    added(document, { kind: 'task', name: 'Bill', in: 'Process_shop', lane: 'lane_stock' });

    expect(document.scopes.lanesOf(document.tree.require('task_bill')).map(({ id }) => id)).toEqual(['lane_stock']);
    await expect(Fixtures.readForWrite('edit/shop-full.bpmn').then((shop) => added(shop, { kind: 'task', in: 'Sub', lane: 'Lane_Ops' }))).rejects.toMatchObject({ code: 'E_INVALID_LANE_MEMBERSHIP' });
  });

  it('gives a node the lane of its anchor, and warns when the flow it enters crosses lanes', async () => {
    const document = await Fixtures.readForWrite('edit/lanes-crossing.bpmn');

    const changes = added(document, { kind: 'task', name: 'Between', after: 'first' });

    expect(document.scopes.lanesOf(document.tree.require('task_between')).map(({ id }) => id)).toEqual(['lane_top']);
    expect(changes.warnings.map(({ code }) => code)).toContain('W_LANE_INHERITED');
    const shop = await Fixtures.readForWrite('edit/shop-full.bpmn');
    added(shop, { kind: 'task', name: 'Inner two', after: 'SubTask' });
    expect(shop.scopes.lanesOf(shop.tree.require('task_innerTwo'))).toEqual([]);
  });

  it('warns that a flow id is ignored when the flow into the node exists, and names the set that renames it', async () => {
    const document = await order();

    const changes = added(document, { kind: 'task', name: 'Mid', flow: 'flow_receivedToCheck', flowId: 'flow_custom' });

    expect(document.tree.has('flow_custom')).toBe(false);
    expect(changes.warnings[0]).toMatchObject({ code: 'W_OPTION_IGNORED', related: ['flow_receivedToCheck'] });
    expect(changes.warnings[0]?.hint).toContain('bpmn set <file> flow_receivedToCheck id=flow_custom');
  });

  it('names the flow into the node when add creates that flow', async () => {
    const document = await order();
    added(document, { kind: 'task', name: 'Loose', ...IN_ORDER_CHECK });

    const changes = added(document, { kind: 'task', name: 'Tail', after: 'task_loose', flowId: 'flow_custom' });

    expect(ends(document.tree.require('flow_custom'))).toBe('task_loose->task_tail');
    expect(changes.warnings).toEqual([]);
  });
});
