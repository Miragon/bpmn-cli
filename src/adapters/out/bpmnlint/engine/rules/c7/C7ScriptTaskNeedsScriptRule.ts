import { is } from 'bpmnlint-utils';
import { defineRule, ERROR_TYPES, type ModdleElement } from '../CamundaRule.js';
import { Values } from '../support/Values.js';
import { C7ExecutableRule } from './C7ExecutableRule.js';
import { C7Diagram } from './support/C7Diagram.js';
import { CamundaAttributes } from './support/CamundaAttributes.js';

/**
 * A script task with neither script nor camunda:resource.
 * Camunda 7 refuses to deploy the file.
 *
 * @example a script task without script
 * <bpmn:scriptTask id="Compute" scriptFormat="groovy" />  <!-- <bpmn:script> or camunda:resource -->
 */
class C7ScriptTaskNeedsScriptRule extends C7ExecutableRule {
  protected checkNode(node: ModdleElement): void {
    if (!is(node, 'bpmn:ScriptTask') || Values.nonEmpty(node.get('script')) || new CamundaAttributes(node).defined('resource') !== undefined) {
      return;
    }
    const prefix = C7Diagram.of(node).prefix;
    this.report(node, `Script task ${node.id} has neither a script nor ${prefix}:resource; the engines refuse the file`, { path: ['script'], type: ERROR_TYPES.PROPERTY_REQUIRED, requiredProperty: ['script', 'resource'], hint: `\`bpmn set <file> ${node.id} scriptFormat=groovy script=...\` (or ${prefix}:resource=deployment://<file>).` });
  }
}

export default defineRule({ ruleName: 'c7-script-task-needs-script', code: 'W_C7_DEPLOY_SCRIPT', impact: 'deploy' }, C7ScriptTaskNeedsScriptRule);
