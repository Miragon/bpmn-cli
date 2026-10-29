import { defineRule, ERROR_TYPES, type ModdleElement } from '../CamundaRule.js';
import { C7ImplementationHostRule } from './C7ImplementationHostRule.js';
import type { ImplementationHost } from './support/ImplementationHost.js';

/**
 * A shell task without a camunda:field named command.
 * Camunda 7 refuses to deploy the file.
 *
 * @example a shell task that runs nothing
 * <bpmn:serviceTask id="Backup" camunda:type="shell" />  <!-- camunda:field name="command" -->
 */
class C7ShellTaskNeedsCommandRule extends C7ImplementationHostRule {
  protected checkHost(node: ModdleElement, host: ImplementationHost): void {
    if (!host.isShell || host.fields().some(({ field }) => field.get('name') === 'command')) {
      return;
    }
    this.report(node, `${host.label} is a shell task without a ${host.prefix}:field named command; the engines refuse the file`, { path: host.pathTo('extensionElements'), type: ERROR_TYPES.EXTENSION_ELEMENT_REQUIRED, node: host.element, requiredExtensionElement: 'camunda:Field', hint: host.fieldHint('name=command stringValue=<command>', 'Add a command field in the XML.') });
  }
}

export default defineRule({ ruleName: 'c7-shell-task-needs-command', code: 'W_C7_DEPLOY_IMPLEMENTATION', impact: 'deploy' }, C7ShellTaskNeedsCommandRule);
