import { is } from 'bpmnlint-utils';
import { C8Rule, defineRule, describeElement, ERROR_TYPES, reportErrors, type ModdleElement, type Reporter } from '../CamundaRules.js';

import { ExecutableScope } from './tasks/ExecutableScope.js';
import { isFeel } from './tasks/utils/value.js';
import { sh } from '../shell.js';
import { feelOf } from './feel/feelOf.js';

/**
 * Reports a multi-instance completion condition that is no FEEL expression: Camunda 8 deploys it,
 * then reads it as a string and raises an incident on every completed instance.
 */
class C8FeelCompletionCondition extends C8Rule {
  protected checkElement(node: ModdleElement, reporter: Reporter): void {
    if (!is(node, 'bpmn:Activity') || is(node, 'bpmn:Transaction')) {
      return;
    }
    const loop = node.loopCharacteristics;
    if (!loop || !is(loop, 'bpmn:MultiInstanceLoopCharacteristics')) {
      return;
    }
    const condition = loop.completionCondition;
    if (!condition || isFeel(condition.body) || !ExecutableScope.covers(node)) {
      return;
    }

    reportErrors(node, reporter, {
      message: `The completion condition "${condition.body ?? ''}" of multi-instance ${describeElement(node)} is no FEEL expression (=...); it deploys, but every completed instance gets an incident (expected a boolean, got a string)`,
      path: ['loopCharacteristics', 'completionCondition'],
      data: {
        type: ERROR_TYPES.EXPRESSION_REQUIRED,
        node: loop,
        parentNode: node,
        property: 'completionCondition',
        hint: `\`bpmn set <file> ${node.id} ${sh(`completion==${feelOf(condition.body ?? '')}`)}\` (check the FEEL syntax).`,
      },
    });
  }
}

export default defineRule(
  { ruleName: 'c8-feel-completion-condition', kind: 'engine-specific', targetEngine: 'c8', findings: { 'c8-feel-completion-condition': ['W_C8_EXPRESSION', 'runtime'] } },
  C8FeelCompletionCondition,
);
