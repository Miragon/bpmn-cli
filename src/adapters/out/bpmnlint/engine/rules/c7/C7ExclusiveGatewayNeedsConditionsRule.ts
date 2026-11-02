import { is } from 'bpmnlint-utils';
import { defineRule, ERROR_TYPES, type ModdleElement } from '../CamundaRule.js';
import { Shell } from '../support/Shell.js';
import { C7ExecutableRule } from './C7ExecutableRule.js';
import { C7ExclusiveGateway } from './support/C7ExclusiveGateway.js';

/**
 * Outgoing flows of an exclusive gateway without condition next to a default flow, or several of
 * them and no default flow.
 * Camunda 7 refuses to deploy the file. The finding is on each such flow, no property of the
 * gateway: the path is null.
 *
 * @example two outgoing flows, neither with a condition nor marked as default
 * <bpmn:exclusiveGateway id="Approved" />
 * <bpmn:sequenceFlow sourceRef="Approved" targetRef="Ship" />    <!-- no condition -->
 * <bpmn:sequenceFlow sourceRef="Approved" targetRef="Reject" />  <!-- no condition -->
 */
class C7ExclusiveGatewayNeedsConditionsRule extends C7ExecutableRule {
  protected checkNode(node: ModdleElement): void {
    if (!is(node, 'bpmn:ExclusiveGateway')) return;
    const gateway = new C7ExclusiveGateway(node);
    const { outgoing, defaultFlow } = gateway;
    const unconditioned = gateway.unconditioned();
    if (outgoing.length < 2 || (!defaultFlow && unconditioned.length < 2)) return;
    for (const flow of unconditioned) {
      const asDefault = defaultFlow ? '' : ` or make one of them the default: \`bpmn set <file> ${flow.id} default=true\``;
      this.report(node, `Flow ${flow.id} of exclusive gateway ${node.id} has no condition and is not the default flow${defaultFlow ? '' : ` (${unconditioned.length} such flows)`}; the engines refuse the file`, { path: null, type: ERROR_TYPES.PROPERTY_REQUIRED, node: flow, requiredProperty: 'conditionExpression', hint: `\`bpmn set <file> ${flow.id} ${Shell.quote('condition=${...}')}\`${asDefault}.` });
    }
  }
}

export default defineRule({ ruleName: 'c7-exclusive-gateway-needs-conditions', code: 'W_C7_DEPLOY_EXCLUSIVE_GATEWAY', impact: 'deploy' }, C7ExclusiveGatewayNeedsConditionsRule);
