import { defineRule, ERROR_TYPES, type ModdleElement } from '../CamundaRule.js';
import { Shell } from '../support/Shell.js';
import { C7ImplementationHostRule } from './C7ImplementationHostRule.js';
import type { ImplementationHost } from './support/ImplementationHost.js';

const SHELL_FLAGS = ['wait', 'redirectError', 'cleanEnv'];

/**
 * A camunda:field of a shell task given as expression, or a flag (wait, redirectError, cleanEnv)
 * other than true or false.
 * The shell task takes fixed values only: Camunda 7 refuses to deploy the file. A field with no
 * value, or with both a string attribute and element, is the field rule's.
 *
 * @example a shell flag that is no boolean
 * <bpmn:serviceTask id="Backup" camunda:type="shell">
 *   <bpmn:extensionElements><camunda:field name="wait" stringValue="yes" /></bpmn:extensionElements>  <!-- true or false -->
 * </bpmn:serviceTask>
 */
class C7ShellFieldValuesFixedRule extends C7ImplementationHostRule {
  protected checkHost(node: ModdleElement, host: ImplementationHost): void {
    if (!host.isShell) return;
    for (const { field, index } of host.fields()) {
      const name = field.get('name') ?? '';
      const fieldPath = host.pathTo('extensionElements', 'values', index);
      const stringValue: string | undefined = field.get('stringValue');
      const string: string | undefined = field.get('string');
      if (stringValue !== undefined && string !== undefined) continue;
      const fixed = string ?? (stringValue ? stringValue : undefined);
      const property = string !== undefined ? 'string' : 'stringValue';
      if (fixed !== undefined && SHELL_FLAGS.includes(name) && !['true', 'false'].includes(fixed.toLowerCase())) {
        this.report(node, `${host.prefix}:field "${name}" of shell task ${host.label} is "${fixed}", not true or false; the engines refuse the file`, { path: [...fieldPath, property], type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED, node: field, property, hint: host.fieldHint(`name=${name} stringValue=true`, 'Use true or false.', ' (or false).') });
      }
      if (fixed === undefined && field.get('expression') !== undefined) {
        this.report(node, `${host.prefix}:field "${name}" of shell task ${host.label} is an expression; the shell task takes fixed values only and the engines refuse the file`, { path: [...fieldPath, 'expression'], type: ERROR_TYPES.PROPERTY_NOT_ALLOWED, node: field, property: 'expression', hint: host.fieldHint(`name=${Shell.quote(name)} stringValue=<value>`, 'Use a stringValue.') });
      }
    }
  }
}

export default defineRule({ ruleName: 'c7-shell-field-values-fixed', code: 'W_C7_DEPLOY_IMPLEMENTATION', impact: 'deploy' }, C7ShellFieldValuesFixedRule);
