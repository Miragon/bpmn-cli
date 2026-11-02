import { is } from 'bpmnlint-utils';
import { C8Rule, defineRule, ERROR_TYPES, type ModdleElement } from '../CamundaRule.js';
import { ElementKinds } from '../support/ElementKinds.js';
import { EngineScope } from '../support/EngineScope.js';
import { Shell } from '../support/Shell.js';
import { Values } from '../support/Values.js';
import { FeelExpression } from './support/feel/FeelExpression.js';

/**
 * A multi-instance completion condition that is no FEEL expression.
 * Camunda 8 deploys it, then reads the condition as a string and raises an incident on every
 * completed instance (expected a boolean, got a string).
 *
 * @example a Camunda 7 (JUEL) completion condition
 * <bpmn:multiInstanceLoopCharacteristics>
 *   <bpmn:completionCondition>${nrOfCompletedInstances == 2}</bpmn:completionCondition>  <!-- =nrOfCompletedInstances = 2 -->
 * </bpmn:multiInstanceLoopCharacteristics>
 */
class C8MultiInstanceCompletionNeedsFeelRule extends C8Rule {
  protected visit(node: ModdleElement): void {
    const loop = is(node, 'bpmn:Activity') && !is(node, 'bpmn:Transaction') ? node.loopCharacteristics : undefined;
    const condition = loop && is(loop, 'bpmn:MultiInstanceLoopCharacteristics') ? loop.completionCondition : undefined;
    if (!condition || Values.isFeel(condition.body) || !EngineScope.C8.runs(node)) {
      return;
    }
    this.report(node, `The completion condition "${condition.body ?? ''}" of multi-instance ${ElementKinds.describe(node)} is no FEEL expression (=...); it deploys, but every completed instance gets an incident (expected a boolean, got a string)`, { path: ['loopCharacteristics', 'completionCondition'], type: ERROR_TYPES.EXPRESSION_REQUIRED, node: loop, property: 'completionCondition', hint: `\`bpmn set <file> ${node.id} ${Shell.quote(`completion==${FeelExpression.fromJuel(condition.body ?? '')}`)}\` (check the FEEL syntax).` });
  }
}

export default defineRule({ ruleName: 'c8-multi-instance-completion-needs-feel', code: 'W_C8_EXPRESSION', impact: 'runtime' }, C8MultiInstanceCompletionNeedsFeelRule);
