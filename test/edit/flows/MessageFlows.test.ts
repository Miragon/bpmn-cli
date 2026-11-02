import { describe, expect, it } from 'vitest';
import { MessageFlows } from '../../../src/edit/flows/MessageFlows.js';
import { EditSession } from '../../../src/edit/session/EditSession.js';
import { Fixtures } from '../../support/Fixtures.js';
import { ChangeSet } from '../../support/ModelValues.js';

async function connect(source: string, target: string, request = {}, path = 'edit/flows-endpoints.bpmn') {
  const document = await Fixtures.readForWrite(path);
  const changes = new ChangeSet();
  const flow = new MessageFlows(new EditSession(document)).create(document.tree.require(source), document.tree.require(target), request, changes);
  return { changes, document, flow };
}

describe('MessageFlows', () => {
  it('draws a message flow between two pools into the collaboration', async () => {
    const { changes, document, flow } = await connect('a_send', 'b_task', { name: 'order' });

    expect(document.tree.collaboration()!.list('messageFlows')).toContain(flow);
    expect(flow.get('sourceRef')).toBe(document.tree.require('a_send'));
    expect(changes.created).toEqual([expect.objectContaining({ kind: 'messageFlow', name: 'order', detail: 'a_send -> b_task' })]);
  });

  it('takes the id the call names', async () => {
    expect((await connect('pool_a', 'pool_empty', { id: 'message_toEmpty' })).flow.id).toBe('message_toEmpty');
  });

  it('reports a message it creates for the flow, as a root element', async () => {
    const { changes, flow } = await connect('a_send', 'b_task', { message: 'Order placed' });

    expect(flow.get<{ name: string }>('messageRef').name).toBe('Order placed');
    expect(changes.created[0]).toEqual(expect.objectContaining({ kind: 'message', name: 'Order placed', detail: 'root element' }));
  });

  it('reports no new message when the flow carries one that exists', async () => {
    const document = await Fixtures.readForWrite('edit/flows-endpoints.bpmn');
    const flows = new MessageFlows(new EditSession(document));
    const changes = new ChangeSet();
    flows.create(document.tree.require('a_send'), document.tree.require('b_task'), { message: 'Order' }, new ChangeSet());

    flows.create(document.tree.require('a_throwMessage'), document.tree.require('b_start'), { message: 'Order' }, changes);

    expect(changes.created.map(({ kind }) => kind)).toEqual(['messageFlow']);
  });

  it('refuses a file without pools', async () => {
    await expect(connect('left_task', 'right_task', {}, 'edit/flows-two-processes.bpmn')).rejects.toMatchObject({ code: 'E_NO_COLLABORATION', details: { element: 'left_task', related: ['right_task'] } });
  });

  it.each([
    ['a gateway as source', 'a_gateway', 'b_task', 'not an interaction node'],
    ['a gateway as target', 'b_task', 'a_gateway', 'not an interaction node'],
    ['an event sub-process', 'a_eventSub', 'b_task', 'event sub-processes cannot send or receive messages'],
    ['a signal event', 'a_endSignal', 'b_task', 'a signal event cannot send messages'],
    ['a timer boundary event as target', 'b_task', 'a_timer', 'a timer event cannot receive messages'],
    ['a catch event as source', 'a_catchMessage', 'b_task', 'catching events cannot send messages'],
    ['a throw event as target', 'b_task', 'a_throwMessage', 'throwing events cannot receive messages'],
  ])('refuses %s', async (_case, source, target, why) => {
    await expect(connect(source, target)).rejects.toMatchObject({ code: 'E_INVALID_ENDPOINT', message: expect.stringContaining(why) });
  });

  it('takes a message throw and a message catch event', async () => {
    expect((await connect('a_throwMessage', 'b_start')).flow.id).toBeDefined();
  });

  it('refuses a task outside every pool', async () => {
    await expect(connect('a_send', 'c_task')).rejects.toMatchObject({ code: 'E_NO_PARTICIPANT', details: { element: 'c_task' } });
  });

  it('refuses two tasks of one pool, and a pool with a task of its own', async () => {
    await expect(connect('a_send', 'a_task')).rejects.toMatchObject({ code: 'E_SAME_POOL', details: { related: ['a_task'] } });
    await expect(connect('pool_a', 'a_task')).rejects.toMatchObject({ code: 'E_SAME_POOL' });
  });
});
