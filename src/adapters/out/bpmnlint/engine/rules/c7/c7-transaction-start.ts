import { is } from 'bpmnlint-utils';
import { C7Rule, defineRule, ERROR_TYPES, reportErrors, type ModdleElement, type Reporter } from '../CamundaRules.js';

import { C7ExecutableScope } from './events/C7ExecutableScope.js';
import { missingStartHint } from './events/missingStartHint.js';

/**
 * Reports a transaction without a start event: Camunda 7 deploys it, but every instance that
 * reaches it fails.
 */
class C7TransactionStart extends C7Rule {
  protected checkElement(node: ModdleElement, reporter: Reporter): void {
    if (!is(node, 'bpmn:Transaction') || !C7ExecutableScope.contains(node)) {
      return;
    }

    const nodes: ModdleElement[] = (node.flowElements ?? []).filter((element: ModdleElement) =>
      is(element, 'bpmn:FlowNode'),
    );
    if (nodes.some((element) => is(element, 'bpmn:StartEvent'))) {
      return;
    }

    const what = nodes.length ? 'has no start event' : 'is empty, without a start event';
    reportErrors(node, reporter, {
      message: `Transaction ${node.id} ${what}: it deploys, but every instance that reaches it fails ("No initial activity found for subprocess ${node.id}")`,
      path: ['flowElements'],
      data: {
        type: ERROR_TYPES.CHILD_ELEMENT_OF_TYPE_REQUIRED,
        node,
        parentNode: null,
        requiredType: 'bpmn:StartEvent',
        hint: missingStartHint(node.id, nodes.length > 0, true),
      },
    });
  }
}

export default defineRule(
  { ruleName: 'c7-transaction-start', kind: 'engine-specific', targetEngine: 'c7', impact: 'runtime' },
  C7TransactionStart,
);
