import { is } from 'bpmnlint-utils';
import { defineRule, ERROR_TYPES, reportErrors, type ModdleElement, type Reporter } from '../CamundaRules.js';

import { C7FlowGraph } from './flows/C7FlowGraph.js';
import { C7FlowRule } from './flows/C7FlowRule.js';

/**
 * Reports a complex gateway a sequence flow connects: Camunda 7 does not run complex gateways and
 * refuses the file. One that nothing connects deploys.
 */
class C7ComplexGateway extends C7FlowRule {
  protected checkRunElement(node: ModdleElement, reporter: Reporter): void {
    if (!is(node, 'bpmn:ComplexGateway')) {
      return;
    }
    const graph = C7FlowGraph.forElement(node);
    const incoming = graph.incoming(node);
    const flows = [...incoming, ...graph.outgoing(node)];
    if (!flows.length) {
      return;
    }
    const end = incoming.length ? 'destination' : 'source';
    reportErrors(node, reporter, {
      message: `Complex gateway ${node.id} is connected; the engines do not run complex gateways and refuse the file (invalid ${end} '${node.id}' of sequence flow ${flows[0].id})`,
      path: null,
      data: {
        type: ERROR_TYPES.ELEMENT_TYPE_NOT_ALLOWED,
        node,
        parentNode: null,
        flows,
        hint: `\`bpmn retype <file> ${node.id} inclusiveGateway\` (or exclusiveGateway: one path).`,
      },
    });
  }
}

export default defineRule(
  { ruleName: 'c7-complex-gateway', kind: 'engine-specific', targetEngine: 'c7', impact: 'deploy' },
  C7ComplexGateway,
);
