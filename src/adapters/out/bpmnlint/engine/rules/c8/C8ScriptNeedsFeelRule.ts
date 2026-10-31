import { is } from 'bpmnlint-utils';
import { defineRule, ERROR_TYPES, type ModdleElement } from '../CamundaRule.js';
import { C8FeelRule } from './C8FeelRule.js';
import { ElementKinds } from '../support/ElementKinds.js';
import { Values } from '../support/Values.js';
import { C8Host } from './support/C8Host.js';
import { ZeebeHint } from './support/ZeebeHint.js';

/**
 * The zeebe:script expression of a script task without job worker that is a static value.
 * Camunda 8 evaluates the script as a FEEL expression and refuses the file.
 *
 * @example a static script expression
 * <bpmn:scriptTask id="Total">
 *   <bpmn:extensionElements><zeebe:script expression="a + b" resultVariable="total" /></bpmn:extensionElements>  <!-- =a + b -->
 * </bpmn:scriptTask>
 */
class C8ScriptNeedsFeelRule extends C8FeelRule {
  protected visit(task: ModdleElement): void {
    if (!this.runs(task) || !is(task, 'bpmn:ScriptTask')) return;
    const [script] = C8Host.valuesOf(task, 'zeebe:Script');
    const expression = script?.expression;
    if (!script || C8Host.valuesOf(task, 'zeebe:TaskDefinition').length || !Values.nonEmpty(expression) || Values.isFeel(expression)) {
      return;
    }
    this.reportAt(this.siteOf(task, script, 'expression'), `The zeebe:script expression "${expression}" of ${ElementKinds.describe(task)} is a static value; Camunda 8 needs a FEEL expression starting with = and refuses the file`, ERROR_TYPES.EXPRESSION_REQUIRED, ZeebeHint.fix(task, script, { expression: `=${expression.trim()}` }));
  }
}

export default defineRule({ ruleName: 'c8-script-needs-feel', code: 'W_C8_DEPLOY_EXPRESSION', impact: 'deploy' }, C8ScriptNeedsFeelRule);
