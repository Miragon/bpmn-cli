import { describe, expect, it } from 'vitest';
import { FlowConnector } from '../../src/edit/FlowConnector.js';
import { EditSession } from '../../src/edit/session/EditSession.js';
import { Fixtures } from '../support/Fixtures.js';
import type { BpmnElement } from '../support/ModelValues.js';

async function connect(operation: Record<string, unknown>, path = 'edit/order-check.bpmn') {
  const document = await Fixtures.readForWrite(path);
  const edit = new EditSession(document);
  edit.begin();
  const parsed = Fixtures.operations([{ op: 'connect', ...operation }]).model[0]!;
  const changes = new FlowConnector(edit).connect(parsed as Parameters<FlowConnector['connect']>[0]);
  return { changes, document, element: (id: string) => document.tree.require(id) };
}

const codes = (changes: { warnings: Array<{ code: string }> }) => changes.warnings.map(({ code }) => code);

describe('FlowConnector', () => {
  it('draws a sequence flow between two tasks and reports it', async () => {
    const { changes, element } = await connect({ source: 'ship', target: 'reject', set: { name: 'back' } });

    expect(changes.created).toEqual([expect.objectContaining({ id: 'flow_shipToReject', detail: 'ship -> reject' })]);
    expect(element('flow_shipToReject').name).toBe('back');
  });

  it('refuses a key of a message flow with the keys of the sequence flow it makes', async () => {
    await expect(connect({ source: 'ship', target: 'reject', set: { message: 'Foo' } })).rejects.toMatchObject({ code: 'E_UNKNOWN_KEY', details: { element: 'flow_shipToReject', candidates: expect.arrayContaining(['condition', 'source']) } });
  });

  it('refuses a language without a condition, as set does', async () => {
    await expect(connect({ source: 'ship', target: 'reject', set: { language: 'groovy' } })).rejects.toMatchObject({ code: 'E_NO_CONDITION' });
  });

  it('writes the id, condition, language and default a connect names', async () => {
    const { element } = await connect({ source: 'gateway_ok', target: 'endEvent_done', id: 'flow_late', set: { condition: '${late}', language: 'juel' } });
    const flow = element('flow_late');

    expect(flow.get<BpmnElement>('conditionExpression').get('body')).toBe('${late}');
    expect(flow.get<BpmnElement>('conditionExpression').get('language')).toBe('juel');

    const defaulted = await connect({ source: 'gateway_ok', target: 'endEvent_done', id: 'flow_late', set: { default: 'true' } });
    expect(defaulted.element('gateway_ok').get('default')).toBe(defaulted.element('flow_late'));
  });

  it('leaves a flow with default=false out of the default of its gateway', async () => {
    const { element } = await connect({ source: 'gateway_ok', target: 'endEvent_done', set: { default: 'false' } });

    expect(element('gateway_ok').get<BpmnElement>('default').id).toBe('flow_okToReject');
  });

  it('hands the keys of the element to the property editor', async () => {
    const { changes, element } = await connect({ source: 'ship', target: 'reject', as: '$flow', set: { doc: 'Goes back.' } });
    const flow = changes.created[0]!;

    expect(element(flow.id).list('documentation')[0]!.get('text')).toBe('Goes back.');
    expect(changes.bindings).toEqual([{ alias: '$flow', el: element(flow.id) }]);
  });

  it('warns of a second way out of a task and a second way into a task', async () => {
    const { changes } = await connect({ source: 'ship', target: 'reject' });

    expect(codes(changes)).toEqual(['W_IMPLICIT_SPLIT', 'W_IMPLICIT_JOIN']);
  });

  it('warns of neither when gateways split and join', async () => {
    const { changes } = await connect({ source: 'gateway_ok', target: 'gateway_join' });

    expect(codes(changes)).toEqual([]);
  });

  it('lets a task loop back to itself and points to the loop marker', async () => {
    const { changes } = await connect({ source: 't_afterPlain', target: 't_afterPlain' }, 'edit/flows-bridge.bpmn');

    expect(changes.notes[0]).toContain('t_afterPlain loops back to itself');
  });

  it.each([
    ['a gateway to itself', 'gateway_ok', 'edit/order-check.bpmn'],
    ['a pool to itself', 'pool_a', 'edit/flows-endpoints.bpmn'],
  ])('refuses to connect %s', async (_case, id, path) => {
    await expect(connect({ source: id, target: id }, path)).rejects.toMatchObject({ code: 'E_INVALID_ENDPOINT', details: { element: id } });
  });

  it('refuses a flow out of a link throw event and into a link catch event', async () => {
    const path = 'edit/flows-endpoints.bpmn';

    await expect(connect({ source: 'a_linkThrow', target: 'a_task' }, path)).rejects.toMatchObject({ code: 'E_INVALID_SOURCE' });
    await expect(connect({ source: 'a_task', target: 'a_linkCatch' }, path)).rejects.toMatchObject({ code: 'E_INVALID_TARGET' });
  });

  it('warns of a connection that exists and draws it again', async () => {
    const { changes } = await connect({ source: 'ship', target: 'gateway_join' });

    expect(changes.created).toHaveLength(1);
    expect(changes.warnings[0]).toEqual(expect.objectContaining({ code: 'W_DUPLICATE_FLOW', related: ['gateway_join', 'flow_shipToJoin'], hint: expect.stringContaining('run the target twice') }));
  });

  it('warns of a message flow that exists, without the words about running twice', async () => {
    const { changes } = await connect({ source: 'a_send', target: 'b_receive' }, 'edit/flows-endpoints.bpmn');

    expect(changes.warnings[0]).toEqual(expect.objectContaining({ code: 'W_DUPLICATE_FLOW', hint: expect.not.stringContaining('twice') }));
  });

  it('keeps the connection that exists under --if-absent and binds its alias', async () => {
    const { changes, element } = await connect({ source: 'ship', target: 'gateway_join', ifAbsent: true, as: '$flow' });

    expect(changes.created).toEqual([]);
    expect(changes.notes).toEqual(['sequenceFlow flow_shipToJoin ship -> gateway_join already exists; nothing to do']);
    expect(changes.bindings).toEqual([{ alias: '$flow', el: element('flow_shipToJoin') }]);
  });

  it('keeps an association that exists under --if-absent', async () => {
    const { changes } = await connect({ source: 'a_note', target: 'a_task', ifAbsent: true }, 'edit/flows-endpoints.bpmn');

    expect(changes.created).toEqual([]);
    expect(changes.notes[0]).toContain('association association_existing');
  });

  it('draws what --if-absent does not find', async () => {
    const { changes } = await connect({ source: 'ship', target: 'reject', ifAbsent: true });

    expect(changes.created).toHaveLength(1);
  });

  it('draws a message flow between pools, with its name and message', async () => {
    const { changes } = await connect({ source: 'a_send', target: 'b_task', id: 'message_new', set: { name: 'order', message: 'Order' } }, 'edit/flows-endpoints.bpmn');

    expect(changes.created.map(({ id, kind }) => `${kind} ${id}`)).toEqual(['message message_order', 'messageFlow message_new']);
  });

  it('ties a note and a data object with the connection each takes', async () => {
    const path = 'edit/flows-endpoints.bpmn';

    expect((await connect({ source: 'a_note2', target: 'a_task', id: 'association_new' }, path)).changes.created).toEqual([expect.objectContaining({ id: 'association_new', kind: 'association' })]);
    expect((await connect({ source: 'a_data', target: 'a_task', id: 'in_new' }, path)).changes.created).toEqual([expect.objectContaining({ id: 'in_new', kind: 'dataAssociation' })]);
  });

  it.each([
    ['a condition on a message flow', { source: 'a_send', target: 'b_task', set: { condition: '${ok}' } }, 'on connect it applies to sequence flows, not to a messageFlow'],
    ['a name on an association', { source: 'a_note2', target: 'a_task', set: { name: 'tied' } }, 'sequence and message flows, not to a association'],
    ['a message on a sequence flow', { source: 'a_task', target: 'a_guarded', set: { message: 'Order' } }, 'message flows (between pools), not to a sequenceFlow'],
  ])('refuses %s', async (_case, operation, message) => {
    await expect(connect(operation, 'edit/flows-endpoints.bpmn')).rejects.toMatchObject({ message: expect.stringContaining(message) });
  });

  it('refuses a condition on a flow out of a parallel gateway', async () => {
    await expect(connect({ source: 'gateway_fork', target: 'task_other', set: { condition: '${ok}' } }, 'model/gateways.bpmn')).rejects.toMatchObject({ code: 'E_INVALID_VALUE', message: expect.stringContaining('cannot have a condition') });
  });

  it('warns of a task made a target of an event-based gateway', async () => {
    const { changes } = await connect({ source: 'gw_wait', target: 't_otherWay' }, 'edit/flows-bridge.bpmn');

    expect(changes.warnings).toEqual([expect.objectContaining({ code: 'W_EVENT_GATEWAY_TARGET', element: 'gw_wait' })]);
  });
});
