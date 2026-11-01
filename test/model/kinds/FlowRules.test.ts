import { describe, expect, it } from 'vitest';
import type { BpmnDocument } from '../../../src/model/document/BpmnDocument.js';
import { Fixtures } from '../../support/Fixtures.js';

describe('FlowRules', () => {
  const refusal = (code: string, fragment: string) => expect.objectContaining({ code, message: expect.stringContaining(fragment) });

  function rolesOf(document: BpmnDocument, source: string, target: string): () => void {
    return () => document.flowRules.assertRoles(document.tree.require(source), document.tree.require(target));
  }

  it('lets a task start and end a flow, but not an end event, a start event or a boundary event on its own side', async () => {
    const { flowRules, tree } = await Fixtures.read('model/events.bpmn');
    const canStart = ['task_review', 'start_timer', 'end_plain', 'throw_link', 'catch_link', 'sub_events', 'Lane_sales'].map((id) => flowRules.canStart(tree.require(id)));
    const canEnd = ['task_review', 'start_timer', 'end_plain', 'throw_link', 'catch_link', 'boundary_soon', 'sub_events'].map((id) => flowRules.canEnd(tree.require(id)));

    expect(canStart).toEqual([true, true, false, false, true, false, false]);
    expect(canEnd).toEqual([true, false, true, true, false, false, false]);
  });

  it.each([
    ['end_plain', 'task_review', 'E_INVALID_SOURCE', 'End event end_plain cannot have outgoing'],
    ['task_review', 'start_timer', 'E_INVALID_TARGET', 'Start event start_timer cannot have incoming'],
    ['throw_link', 'task_review', 'E_INVALID_SOURCE', 'Link throw event throw_link cannot have outgoing'],
    ['task_review', 'catch_link', 'E_INVALID_TARGET', 'Link catch event catch_link cannot have incoming'],
    ['task_review', 'boundary_soon', 'E_INVALID_TARGET', 'Boundary event boundary_soon cannot have incoming'],
    ['sub_events', 'task_review', 'E_INVALID_SOURCE', 'Event sub-process sub_events cannot have sequence flows'],
    ['task_review', 'sub_events', 'E_INVALID_TARGET', 'Event sub-process sub_events cannot have sequence flows'],
    ['Lane_sales', 'task_review', 'E_INVALID_SOURCE', 'cannot be the source of a sequence flow'],
    ['task_review', 'Lane_sales', 'E_INVALID_TARGET', 'cannot be the target of a sequence flow'],
  ])('refuses a flow from %s to %s with %s', async (source, target, code, fragment) => {
    const document = await Fixtures.read('model/events.bpmn');

    expect(rolesOf(document, source, target)).toThrow(refusal(code, fragment));
    expect(rolesOf(document, source, target)).toThrow(expect.objectContaining({ details: expect.objectContaining({ element: code === 'E_INVALID_SOURCE' ? source : target }) }));
  });

  it('accepts a flow between two tasks, in the same scope', async () => {
    const { flowRules, tree } = await Fixtures.read('model/events.bpmn');

    expect(() => flowRules.assertEndpoints(tree.require('task_review'), tree.require('task_send'))).not.toThrow();
  });

  it('refuses a flow across scopes, naming both scopes and where to go instead', async () => {
    const { flowRules, tree } = await Fixtures.read('model/events.bpmn');

    expect(() => flowRules.assertEndpoints(tree.require('task_inside'), tree.require('task_review'))).toThrow(
      expect.objectContaining({ code: 'E_CROSS_SCOPE', message: expect.stringContaining('task_inside is in sub_adhoc, task_review in Process_events'), details: expect.objectContaining({ element: 'task_inside', related: ['task_review'] }) }),
    );
  });

  it('refuses a second incoming flow into what an event-based gateway leads to, with the way to join before the gateway', async () => {
    const { flowRules, flows, tree } = await Fixtures.read('model/gateways.bpmn');
    const gateway = tree.require('gateway_wait');
    const message = tree.require('catch_message');
    const other = tree.require('task_other');
    const unrelated = flows.incoming(other)[0]!;

    expect(() => flowRules.assertEndpoints(gateway, message)).toThrow(
      expect.objectContaining({ code: 'E_INVALID_TARGET', details: expect.objectContaining({ element: 'catch_message', related: ['gateway_wait', 'flow_to_message'], hint: 'Join before the gateway instead: `bpmn set <file> <flowId> target=gateway_wait`.' }) }),
    );
    expect(() => flowRules.assertEndpoints(other, message)).toThrow(expect.objectContaining({ details: expect.objectContaining({ hint: 'Join before the gateway instead: `bpmn connect <file> task_other gateway_wait`.' }) }));
    expect(() => flowRules.assertEndpoints(other, message, unrelated)).toThrow(expect.objectContaining({ details: expect.objectContaining({ hint: 'Join before the gateway instead: `bpmn set <file> flow_to_other target=gateway_wait`.' }) }));
  });

  it('accepts the flow that replaces the only incoming flow of an event-based gateway target', async () => {
    const { flowRules, flows, tree } = await Fixtures.read('model/gateways.bpmn');
    const message = tree.require('catch_message');

    expect(() => flowRules.assertEndpoints(tree.require('gateway_wait'), message, flows.incoming(message)[0])).not.toThrow();
  });

  it('refuses an empty condition expression and accepts none or a filled one', async () => {
    const { flowRules } = await Fixtures.read('model/events.bpmn');

    expect(() => flowRules.assertCondition('  ')).toThrow(expect.objectContaining({ code: 'E_INVALID_VALUE', message: 'The condition expression is empty' }));
    expect(() => flowRules.assertCondition(undefined)).not.toThrow();
    expect(() => flowRules.assertCondition('${ok}')).not.toThrow();
  });

  it('refuses a condition on a flow out of a parallel gateway or an event-based gateway, and out of nothing else', async () => {
    const { flowRules, tree } = await Fixtures.read('model/gateways.bpmn');

    expect(() => flowRules.assertConditionTaken(tree.require('gateway_fork'), '${x}', 'flow_to_wait')).toThrow(
      expect.objectContaining({ code: 'E_INVALID_VALUE', message: expect.stringContaining('always takes all of its outgoing paths'), details: expect.objectContaining({ element: 'flow_to_wait', hint: expect.stringContaining('bpmn retype <file> gateway_fork exclusiveGateway') }) }),
    );
    expect(() => flowRules.assertConditionTaken(tree.require('gateway_wait'), '${x}')).toThrow(expect.objectContaining({ message: expect.stringContaining('takes the path of the event that happens first') }));
    expect(() => flowRules.assertConditionTaken(tree.require('gateway_any'), '${x}')).not.toThrow();
    expect(() => flowRules.assertConditionTaken(tree.require('gateway_fork'), undefined)).not.toThrow();
  });
});
