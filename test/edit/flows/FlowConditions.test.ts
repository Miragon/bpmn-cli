import { describe, expect, it } from 'vitest';
import { FlowConditions } from '../../../src/edit/flows/FlowConditions.js';
import { SequenceFlows } from '../../../src/edit/flows/SequenceFlows.js';
import { EditSession } from '../../../src/edit/session/EditSession.js';
import { Fixtures } from '../../support/Fixtures.js';
import { type BpmnElement, ChangeSet } from '../../support/ModelValues.js';

async function open(path: string) {
  const document = await Fixtures.readForWrite(path);
  const edit = new EditSession(document);
  const element = (id: string) => document.tree.require(id);
  return { changes: new ChangeSet(), document, edit, element, conditions: new FlowConditions(edit) };
}

const expressionOf = (flow: BpmnElement) => flow.get<BpmnElement | undefined>('conditionExpression')?.get('body');

describe('FlowConditions', () => {
  describe('setDefault', () => {
    it('makes a flow the default of its gateway and drops its condition', async () => {
      const { element, conditions } = await open('edit/order-check.bpmn');

      conditions.setDefault(element('flow_okToShip'), true);

      expect(element('gateway_ok').get('default')).toBe(element('flow_okToShip'));
      expect(expressionOf(element('flow_okToShip'))).toBeUndefined();
    });

    it('lets a task carry a default flow, but refuses a parallel gateway', async () => {
      const { element, conditions } = await open('edit/order-check.bpmn');
      conditions.setDefault(element('flow_checkToOk'), true);
      expect(element('check').get('default')).toBe(element('flow_checkToOk'));

      const parallel = await open('model/gateways.bpmn');
      expect(() => parallel.conditions.setDefault(parallel.element('flow_to_wait'), true)).toThrow(expect.objectContaining({ code: 'E_INVALID_DEFAULT', details: { element: 'flow_to_wait' } }));
    });

    it('clears the default only on the flow that holds it', async () => {
      const { element, conditions } = await open('edit/order-check.bpmn');

      conditions.setDefault(element('flow_okToShip'), false);
      expect(element('gateway_ok').get<BpmnElement>('default').id).toBe('flow_okToReject');

      conditions.setDefault(element('flow_okToReject'), false);
      expect(element('gateway_ok').get('default')).toBeUndefined();
    });
  });

  describe('setCondition', () => {
    it('writes the condition of a flow and ends its time as the default', async () => {
      const { element, conditions } = await open('edit/order-check.bpmn');

      conditions.setCondition(element('flow_okToReject'), '${late}');

      expect(expressionOf(element('flow_okToReject'))).toBe('${late}');
      expect(element('gateway_ok').get('default')).toBeUndefined();
    });

    it('leaves the default of the gateway when another flow gets a condition', async () => {
      const { element, conditions } = await open('edit/order-check.bpmn');

      conditions.setCondition(element('flow_okToShip'), '${late}');

      expect(element('gateway_ok').get<BpmnElement>('default').id).toBe('flow_okToReject');
    });

    it('takes the condition off when given none', async () => {
      const { element, conditions } = await open('edit/order-check.bpmn');

      conditions.setCondition(element('flow_okToShip'), undefined);

      expect(expressionOf(element('flow_okToShip'))).toBeUndefined();
    });

    it('refuses a condition on a flow out of a parallel gateway, and names the flow', async () => {
      const { element, conditions } = await open('model/gateways.bpmn');

      expect(() => conditions.setCondition(element('flow_to_wait'), '${ok}')).toThrow(expect.objectContaining({ code: 'E_INVALID_VALUE', details: expect.objectContaining({ element: 'flow_to_wait' }) }));
    });
  });

  describe('dropIgnoredConditions', () => {
    it('drops the conditions a gateway retyped to parallel would ignore, and warns of each', async () => {
      const { changes, document, edit, element, conditions } = await open('edit/order-check.bpmn');
      const fork = document.tree.create('bpmn:ParallelGateway', { id: 'fork' });
      element('Process_orderCheck').add('flowElements', fork);
      const flow = element('flow_okToShip');
      const sequenceFlows = new SequenceFlows(edit);
      sequenceFlows.redirect(flow, { source: fork });
      sequenceFlows.redirect(element('flow_okToReject'), { source: fork });

      conditions.dropIgnoredConditions(fork, changes);

      expect(expressionOf(flow)).toBeUndefined();
      expect(changes.warnings).toEqual([expect.objectContaining({ code: 'W_CONDITION_DROPPED', related: ['fork'] })]);
    });

    it('leaves the conditions of an exclusive gateway alone', async () => {
      const { changes, element, conditions } = await open('edit/order-check.bpmn');

      conditions.dropIgnoredConditions(element('gateway_ok'), changes);

      expect(expressionOf(element('flow_okToShip'))).toBe('${ok}');
    });
  });
});
