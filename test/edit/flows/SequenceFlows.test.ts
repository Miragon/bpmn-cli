import { describe, expect, it } from 'vitest';
import { SequenceFlows } from '../../../src/edit/flows/SequenceFlows.js';
import { EditSession } from '../../../src/edit/session/EditSession.js';
import { Fixtures } from '../../support/Fixtures.js';
import { type BpmnElement, ChangeSet } from '../../support/ModelValues.js';

async function open(path: string) {
  const document = await Fixtures.readForWrite(path);
  const edit = new EditSession(document);
  const element = (id: string) => document.tree.require(id);
  return { changes: new ChangeSet(), document, element, flows: new SequenceFlows(edit) };
}

const expressionOf = (flow: BpmnElement) => flow.get<BpmnElement | undefined>('conditionExpression')?.get('body');

describe('SequenceFlows', () => {
  describe('create', () => {
    it('joins two nodes and declares the flow behind the last flow of its source', async () => {
      const { document, element, flows } = await open('edit/order-check.bpmn');

      const flow = flows.create(element('ship'), element('reject'), { name: 'back' });
      const declared = document.tree.processes()[0]!.list('flowElements');

      expect(flow.id).toBe('flow_shipToReject');
      expect(element('ship').list('outgoing')).toContain(flow);
      expect(element('reject').list('incoming')).toContain(flow);
      expect(flow.name).toBe('back');
      expect(declared.indexOf(flow)).toBe(declared.indexOf(element('flow_shipToJoin')) + 1);
    });

    it('declares a flow behind the node of a caller that names it', async () => {
      const { document, element, flows } = await open('edit/order-check.bpmn');

      const flow = flows.create(element('ship'), element('reject'), {}, element('ship'));
      const declared = document.tree.processes()[0]!.list('flowElements');

      expect(declared.indexOf(flow)).toBe(declared.indexOf(element('ship')) + 1);
    });

    it('declares the first flow of a node behind the node', async () => {
      const { document, element, flows } = await open('edit/flows-endpoints.bpmn');

      const flow = flows.create(element('a_guarded'), element('a_undo'));
      const declared = document.tree.require('Process_a').list('flowElements');

      expect(declared.indexOf(flow)).toBe(declared.indexOf(element('a_guarded')) + 1);
    });

    it('gives a new flow its condition in the language asked for, and makes one the default', async () => {
      const { element, flows } = await open('edit/order-check.bpmn');

      const conditioned = flows.create(element('gateway_ok'), element('endEvent_done'), { condition: '${late}', language: 'juel' });
      const defaulted = flows.create(element('gateway_ok'), element('gateway_join'), { isDefault: true });

      expect(expressionOf(conditioned)).toBe('${late}');
      expect(conditioned.get<BpmnElement>('conditionExpression').get('language')).toBe('juel');
      expect(element('gateway_ok').get('default')).toBe(defaulted);
    });

    it('refuses a flow out of a link throw event and into a link catch event', async () => {
      const { element, flows } = await open('edit/flows-endpoints.bpmn');

      expect(() => flows.create(element('a_linkThrow'), element('a_task'))).toThrow(expect.objectContaining({ code: 'E_INVALID_SOURCE' }));
      expect(() => flows.create(element('a_task'), element('a_linkCatch'))).toThrow(expect.objectContaining({ code: 'E_INVALID_TARGET' }));
    });

    it('takes a flow into a link throw event and out of a link catch event', async () => {
      const { element, flows } = await open('edit/flows-endpoints.bpmn');

      expect(flows.create(element('a_task'), element('a_linkThrow')).get('targetRef')).toBe(element('a_linkThrow'));
      expect(flows.create(element('a_linkCatch'), element('a_task')).get('sourceRef')).toBe(element('a_linkCatch'));
    });

    it('refuses a flow into the event sub-process of its scope, across scopes, and with a blank condition', async () => {
      const { element, flows } = await open('edit/flows-endpoints.bpmn');

      expect(() => flows.create(element('a_task'), element('a_eventSub'))).toThrow(expect.objectContaining({ code: 'E_INVALID_TARGET' }));
      expect(() => flows.create(element('a_task'), element('a_inner'))).toThrow(expect.objectContaining({ code: 'E_CROSS_SCOPE' }));
      expect(() => flows.create(element('a_task'), element('a_guarded'), { condition: ' ' })).toThrow(expect.objectContaining({ code: 'E_INVALID_VALUE' }));
    });

    it('keeps a condition off a flow out of a parallel gateway', async () => {
      const { element, flows } = await open('edit/flows-endpoints.bpmn');

      expect(() => flows.create(element('a_fork'), element('a_task'), { condition: '${ok}' })).toThrow(expect.objectContaining({ code: 'E_INVALID_VALUE', message: expect.stringContaining('always takes all') }));
    });
  });

  describe('remove', () => {
    it('takes a flow off both ends and frees its id', async () => {
      const { document, element, flows } = await open('edit/order-check.bpmn');

      flows.remove(element('flow_shipToJoin'));

      expect(element('ship').list('outgoing')).toEqual([]);
      expect(element('gateway_join').list('incoming').map(({ id }) => id)).toEqual(['flow_rejectToJoin']);
      expect(document.tree.has('flow_shipToJoin')).toBe(false);
    });

    it('clears the default of a gateway whose default flow goes', async () => {
      const { element, flows } = await open('edit/order-check.bpmn');

      flows.remove(element('flow_okToReject'));

      expect(element('gateway_ok').get('default')).toBeUndefined();
    });

    it('removes a flow the file left without ends', async () => {
      const { document, element, flows } = await open('edit/flows-bridge.bpmn');

      flows.remove(element('f_dangling'));

      expect(document.tree.has('f_dangling')).toBe(false);
    });

    it('removes the note lines on a flow and reports them', async () => {
      const { changes, document, element, flows } = await open('edit/flows-line.bpmn');

      flows.remove(element('flow_aToB'), changes);

      expect(document.tree.has('association_noteToFlow')).toBe(false);
      expect(changes.removed).toEqual([{ id: 'association_noteToFlow', kind: 'association' }]);
    });
  });

  describe('redirect', () => {
    it('moves a flow to a new target and clears it from the old one', async () => {
      const { element, flows } = await open('edit/flows-line.bpmn');

      const renamedFrom = flows.redirect(element('flow_aToB'), { target: element('task_c') });

      expect(renamedFrom).toBe('flow_aToB');
      expect(element('task_b').list('incoming')).toEqual([]);
      expect(element('task_c').list('incoming').map(({ id }) => id)).toContain('flow_aToC');
    });

    it('takes the default marker off the old source of a default flow', async () => {
      const { element, flows } = await open('edit/order-check.bpmn');

      flows.redirect(element('flow_okToReject'), { source: element('ship') });

      expect(element('gateway_ok').get('default')).toBeUndefined();
    });

    it('leaves a source that keeps the flow alone', async () => {
      const { element, flows } = await open('edit/order-check.bpmn');
      const flow = element('flow_okToReject');

      flows.redirect(flow, { target: element('ship') });

      expect(element('gateway_ok').get('default')).toBe(flow);
    });

    it('refuses a second flow into a target of an event-based gateway, and hints the join before it', async () => {
      const { element, flows } = await open('edit/flows-bridge.bpmn');

      expect(() => flows.redirect(element('f_groupIn'), { target: element('catch_msg') })).toThrow(expect.objectContaining({ code: 'E_INVALID_TARGET', details: expect.objectContaining({ related: expect.arrayContaining(['gw_wait']) }) }));
    });
  });

  describe('splice', () => {
    it('puts a node into a flow, renames the flow after it, and adds the flow behind it', async () => {
      const { document, element, flows } = await open('edit/flows-line.bpmn');
      const node = document.tree.create('bpmn:Task', { id: 'task_new', name: 'New' });
      element('Process_line').add('flowElements', node);

      const { first, second, renamedFrom } = flows.splice(element('flow_aToB'), node);

      expect(first.id).toBe('flow_aToNew');
      expect(first.get('targetRef')).toBe(node);
      expect(second.get('sourceRef')).toBe(node);
      expect(second.get('targetRef')).toBe(element('task_b'));
      expect(renamedFrom).toBe('flow_aToB');
    });

    it('keeps the id of a flow that does not name its ends', async () => {
      const { document, element, flows } = await open('edit/flows-bridge.bpmn');
      const node = document.tree.create('bpmn:Task', { id: 'task_new', name: 'New' });
      element('Process_bridge').add('flowElements', node);

      const spliced = flows.splice(element('f_aPlain'), node);

      expect(spliced.first.id).toBe('f_aPlain');
      expect(spliced).not.toHaveProperty('renamedFrom');
    });

    it('refuses to put an end event in the middle of a flow', async () => {
      const { document, element, flows } = await open('edit/flows-line.bpmn');
      const end = document.tree.create('bpmn:EndEvent', { id: 'endEvent_new' });
      element('Process_line').add('flowElements', end);

      expect(() => flows.splice(element('flow_aToB'), end)).toThrow(expect.objectContaining({ code: 'E_INVALID_SOURCE' }));
    });
  });

  describe('setDefault', () => {
    it('makes a flow the default of its gateway and drops its condition', async () => {
      const { element, flows } = await open('edit/order-check.bpmn');

      flows.setDefault(element('flow_okToShip'), true);

      expect(element('gateway_ok').get('default')).toBe(element('flow_okToShip'));
      expect(expressionOf(element('flow_okToShip'))).toBeUndefined();
    });

    it('lets a task carry a default flow, but refuses a parallel gateway', async () => {
      const { element, flows } = await open('edit/order-check.bpmn');
      flows.setDefault(element('flow_checkToOk'), true);
      expect(element('check').get('default')).toBe(element('flow_checkToOk'));

      const parallel = await open('model/gateways.bpmn');
      expect(() => parallel.flows.setDefault(parallel.element('flow_to_wait'), true)).toThrow(expect.objectContaining({ code: 'E_INVALID_DEFAULT', details: { element: 'flow_to_wait' } }));
    });

    it('clears the default only on the flow that holds it', async () => {
      const { element, flows } = await open('edit/order-check.bpmn');

      flows.setDefault(element('flow_okToShip'), false);
      expect(element('gateway_ok').get<BpmnElement>('default').id).toBe('flow_okToReject');

      flows.setDefault(element('flow_okToReject'), false);
      expect(element('gateway_ok').get('default')).toBeUndefined();
    });
  });

  describe('setCondition', () => {
    it('writes the condition of a flow and ends its time as the default', async () => {
      const { element, flows } = await open('edit/order-check.bpmn');

      flows.setCondition(element('flow_okToReject'), '${late}');

      expect(expressionOf(element('flow_okToReject'))).toBe('${late}');
      expect(element('gateway_ok').get('default')).toBeUndefined();
    });

    it('leaves the default of the gateway when another flow gets a condition', async () => {
      const { element, flows } = await open('edit/order-check.bpmn');

      flows.setCondition(element('flow_okToShip'), '${late}');

      expect(element('gateway_ok').get<BpmnElement>('default').id).toBe('flow_okToReject');
    });

    it('takes the condition off when given none', async () => {
      const { element, flows } = await open('edit/order-check.bpmn');

      flows.setCondition(element('flow_okToShip'), undefined);

      expect(expressionOf(element('flow_okToShip'))).toBeUndefined();
    });

    it('refuses a condition on a flow out of a parallel gateway, and names the flow', async () => {
      const { element, flows } = await open('model/gateways.bpmn');

      expect(() => flows.setCondition(element('flow_to_wait'), '${ok}')).toThrow(expect.objectContaining({ code: 'E_INVALID_VALUE', details: expect.objectContaining({ element: 'flow_to_wait' }) }));
    });
  });

  describe('dropIgnoredConditions', () => {
    it('drops the conditions a gateway retyped to parallel would ignore, and warns of each', async () => {
      const { changes, document, element, flows } = await open('edit/order-check.bpmn');
      const fork = document.tree.create('bpmn:ParallelGateway', { id: 'fork' });
      element('Process_orderCheck').add('flowElements', fork);
      const flow = element('flow_okToShip');
      flows.redirect(flow, { source: fork });
      flows.redirect(element('flow_okToReject'), { source: fork });

      flows.dropIgnoredConditions(fork, changes);

      expect(expressionOf(flow)).toBeUndefined();
      expect(changes.warnings).toEqual([expect.objectContaining({ code: 'W_CONDITION_DROPPED', related: ['fork'] })]);
    });

    it('leaves the conditions of an exclusive gateway alone', async () => {
      const { changes, element, flows } = await open('edit/order-check.bpmn');

      flows.dropIgnoredConditions(element('gateway_ok'), changes);

      expect(expressionOf(element('flow_okToShip'))).toBe('${ok}');
    });
  });

  it('re-attaches the note line of a flow to the flow that replaces it', async () => {
    const { changes, element, flows } = await open('edit/flows-line.bpmn');

    expect(flows.carryAssociations(element('flow_aToB'), element('flow_bToC'), changes).map(({ id }) => id)).toEqual(['association_noteToFlow']);
    expect(element('association_noteToFlow').get('targetRef')).toBe(element('flow_bToC'));
    expect(element('association_noteToFlow').get('sourceRef')).toBe(element('note_flow'));
    expect(changes.changed).toEqual([{ id: 'association_noteToFlow', kind: 'association', detail: 're-attached from flow_aToB to flow_bToC' }]);
  });
});
