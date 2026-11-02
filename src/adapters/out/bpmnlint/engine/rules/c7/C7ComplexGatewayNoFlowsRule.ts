import { is } from 'bpmnlint-utils';
import { defineRule, ERROR_TYPES, type ModdleElement } from '../CamundaRule.js';
import { C7ExecutableRule } from './C7ExecutableRule.js';
import { C7FlowGraph } from './support/C7FlowGraph.js';

/**
 * A complex gateway a sequence flow connects.
 * The engines do not run complex gateways: Camunda 7 refuses the file; one nothing connects deploys.
 *
 * @example a connected complex gateway
 * <bpmn:complexGateway id="Join" />
 * <bpmn:sequenceFlow sourceRef="Join" targetRef="Ship" />
 */
class C7ComplexGatewayNoFlowsRule extends C7ExecutableRule {
  protected checkNode(node: ModdleElement): void {
    if (!is(node, 'bpmn:ComplexGateway')) return;
    const graph = C7FlowGraph.forElement(node);
    const incoming = graph.incoming(node);
    const flows = [...incoming, ...graph.outgoing(node)];
    if (flows.length) {
      this.report(node, `Complex gateway ${node.id} is connected; the engines do not run complex gateways and refuse the file (invalid ${incoming.length ? 'destination' : 'source'} '${node.id}' of sequence flow ${flows[0].id})`, { path: null, type: ERROR_TYPES.ELEMENT_TYPE_NOT_ALLOWED, flows, hint: `\`bpmn retype <file> ${node.id} inclusiveGateway\` (or exclusiveGateway: one path).` });
    }
  }
}

export default defineRule({ ruleName: 'c7-complex-gateway-no-flows', code: 'W_C7_DEPLOY_COMPLEX_GATEWAY', impact: 'deploy' }, C7ComplexGatewayNoFlowsRule);
