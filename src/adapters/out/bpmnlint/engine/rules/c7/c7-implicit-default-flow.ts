import { is } from 'bpmnlint-utils';
import { defineRule, ERROR_TYPES, reportErrors, type ModdleElement, type Reporter } from '../CamundaRules.js';

import { C7FlowGraph } from './flows/C7FlowGraph.js';
import { C7FlowRule } from './flows/C7FlowRule.js';

/**
 * Reports an exclusive gateway without default flow whose branches all have a condition but one:
 * Camunda 7 takes that one as the default and logs a warning.
 */
class C7ImplicitDefaultFlow extends C7FlowRule {
  protected checkRunElement(node: ModdleElement, reporter: Reporter): void {
    if (!is(node, 'bpmn:ExclusiveGateway') || node.default) {
      return;
    }
    const outgoing = C7FlowGraph.forElement(node).outgoing(node);
    const unconditioned = outgoing.filter((flow) => !flow.conditionExpression);
    if (outgoing.length < 2 || unconditioned.length !== 1) {
      return;
    }
    const [flow] = unconditioned;
    reportErrors(node, reporter, {
      message: `Flow ${flow.id} of exclusive gateway ${node.id} has no condition and is not the default flow; the engines take it as the default and log a warning`,
      path: ['default'],
      data: {
        type: ERROR_TYPES.PROPERTY_REQUIRED,
        node,
        parentNode: null,
        requiredProperty: 'default',
        sequenceFlow: flow,
        hint: `\`bpmn set <file> ${flow.id} default=true\`.`,
      },
    });
  }
}

export default defineRule(
  { ruleName: 'c7-implicit-default-flow', kind: 'engine-specific', targetEngine: 'c7', impact: 'practice' },
  C7ImplicitDefaultFlow,
);
