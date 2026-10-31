import { is } from 'bpmnlint-utils';
import { defineRule, ERROR_TYPES, type ModdleElement } from '../CamundaRule.js';
import { C7ExecutableRule } from './C7ExecutableRule.js';
import { C7ExclusiveGateway } from './support/C7ExclusiveGateway.js';

/**
 * Exactly one outgoing flow of an exclusive gateway without condition, and no default flow.
 * Camunda 7 takes that flow as the default and logs a warning, so the model reads otherwise than
 * the engine runs it.
 *
 * @example a flow the engines take as the default
 * <bpmn:exclusiveGateway id="Approved" />
 * <bpmn:sequenceFlow sourceRef="Approved" targetRef="Ship"><bpmn:conditionExpression>${approved}</bpmn:conditionExpression></bpmn:sequenceFlow>
 * <bpmn:sequenceFlow id="Other" sourceRef="Approved" targetRef="Reject" />  <!-- default="Other" -->
 */
class C7ExclusiveGatewayNeedsDefaultRule extends C7ExecutableRule {
  protected checkNode(node: ModdleElement): void {
    if (!is(node, 'bpmn:ExclusiveGateway')) return;
    const gateway = new C7ExclusiveGateway(node);
    const unconditioned = gateway.unconditioned();
    if (gateway.outgoing.length < 2 || gateway.defaultFlow || unconditioned.length !== 1) {
      return;
    }
    const [flow] = unconditioned;
    this.report(node, `Flow ${flow.id} of exclusive gateway ${node.id} has no condition and is not the default flow; the engines take it as the default and log a warning`, { path: ['default'], type: ERROR_TYPES.PROPERTY_REQUIRED, requiredProperty: 'default', sequenceFlow: flow, hint: `\`bpmn set <file> ${flow.id} default=true\`.` });
  }
}

export default defineRule({ ruleName: 'c7-exclusive-gateway-needs-default', code: 'W_C7_EXCLUSIVE_GATEWAY_DEFAULT', impact: 'practice' }, C7ExclusiveGatewayNeedsDefaultRule);
