import { is } from 'bpmnlint-utils';
import { defineRule, ERROR_TYPES, type ModdleElement } from '../CamundaRule.js';
import { C7ExecutableRule } from './C7ExecutableRule.js';
import { C7FlowGraph } from './support/C7FlowGraph.js';

/**
 * An exclusive gateway without outgoing flow.
 * Camunda 7 refuses to deploy the file.
 *
 * @example a gateway that leads nowhere
 * <bpmn:exclusiveGateway id="Approved" />  <!-- no sequenceFlow with sourceRef="Approved" -->
 */
class C7ExclusiveGatewayNeedsOutgoingRule extends C7ExecutableRule {
  protected checkNode(node: ModdleElement): void {
    if (!is(node, 'bpmn:ExclusiveGateway') || C7FlowGraph.forElement(node).outgoing(node).length) {
      return;
    }
    this.report(node, `Exclusive gateway ${node.id} has no outgoing flow; the engines refuse the file`, { path: ['outgoing'], type: ERROR_TYPES.PROPERTY_REQUIRED, requiredProperty: 'outgoing', hint: `Continue it: \`bpmn add <file> <kind> "<Name>" --after ${node.id}\`.` });
  }
}

export default defineRule({ ruleName: 'c7-exclusive-gateway-needs-outgoing', code: 'W_C7_DEPLOY_EXCLUSIVE_GATEWAY', impact: 'deploy' }, C7ExclusiveGatewayNeedsOutgoingRule);
