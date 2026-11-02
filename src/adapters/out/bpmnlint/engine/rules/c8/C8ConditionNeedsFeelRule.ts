import { defineRule, ERROR_TYPES, type ModdleElement } from '../CamundaRule.js';
import { Values } from '../support/Values.js';
import { C8FeelRule } from './C8FeelRule.js';

/**
 * A sequence flow condition, an ad-hoc completion condition or the condition of a conditional
 * event that is no FEEL expression (a static or Camunda 7 JUEL value).
 * Camunda 8 evaluates conditions as FEEL and refuses the file.
 *
 * @example a Camunda 7 (JUEL) condition
 * <bpmn:conditionExpression>${amount > 1000}</bpmn:conditionExpression>  <!-- FEEL: =amount > 1000 -->
 */
class C8ConditionNeedsFeelRule extends C8FeelRule {
  protected visit(node: ModdleElement): void {
    const condition = this.runs(node) ? this.conditionOf(node) : undefined;
    if (!condition || Values.isFeel(condition.body)) return;
    const { site, what, label, body, notFeelHint } = condition;
    this.reportAt(site, `The ${what} "${body.trim()}" of ${label} is no FEEL expression; Camunda 8 needs one starting with = and refuses the file`, ERROR_TYPES.EXPRESSION_REQUIRED, notFeelHint);
  }
}

export default defineRule({ ruleName: 'c8-condition-needs-feel', code: 'W_C8_DEPLOY_EXPRESSION', impact: 'deploy' }, C8ConditionNeedsFeelRule);
