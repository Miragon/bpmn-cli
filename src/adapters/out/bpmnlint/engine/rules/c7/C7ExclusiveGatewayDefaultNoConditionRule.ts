import { is } from 'bpmnlint-utils';
import { defineRule, ERROR_TYPES, type ModdleElement } from '../CamundaRule.js';
import { C7ExecutableRule } from './C7ExecutableRule.js';
import { C7ExclusiveGateway } from './support/C7ExclusiveGateway.js';

/**
 * A condition on the default flow of an exclusive gateway, or on its only outgoing flow.
 * Camunda 7 refuses to deploy the file. The condition of the flow goes: the path is null, as the
 * flow is no property of the gateway.
 *
 * @example a default flow with a condition
 * <bpmn:exclusiveGateway id="Approved" default="Ship" />
 * <bpmn:sequenceFlow id="Ship" sourceRef="Approved" targetRef="Send">
 *   <bpmn:conditionExpression>${approved}</bpmn:conditionExpression>  <!-- the default takes none -->
 * </bpmn:sequenceFlow>
 */
class C7ExclusiveGatewayDefaultNoConditionRule extends C7ExecutableRule {
  protected checkNode(node: ModdleElement): void {
    if (!is(node, 'bpmn:ExclusiveGateway')) return;
    const { outgoing, defaultFlow } = new C7ExclusiveGateway(node);
    if (outgoing.length === 1) {
      const [flow] = outgoing;
      if (flow.conditionExpression) {
        this.reportCondition(node, flow, flow === defaultFlow ? `Default flow ${flow.id} of exclusive gateway ${node.id} has a condition; the engines refuse the file` : `Exclusive gateway ${node.id} has a single outgoing flow ${flow.id} with a condition; the engines refuse the file`);
      }
    } else if (defaultFlow?.conditionExpression && outgoing.includes(defaultFlow)) {
      this.reportCondition(node, defaultFlow, `Default flow ${defaultFlow.id} of exclusive gateway ${node.id} has a condition; the engines refuse the file`);
    }
  }

  private reportCondition(node: ModdleElement, flow: ModdleElement, message: string): void {
    this.report(node, message, { path: null, type: ERROR_TYPES.PROPERTY_NOT_ALLOWED, node: flow, property: 'conditionExpression', hint: `\`bpmn set <file> ${flow.id} condition=\`.` });
  }
}

export default defineRule({ ruleName: 'c7-exclusive-gateway-default-no-condition', code: 'W_C7_DEPLOY_EXCLUSIVE_GATEWAY', impact: 'deploy' }, C7ExclusiveGatewayDefaultNoConditionRule);
