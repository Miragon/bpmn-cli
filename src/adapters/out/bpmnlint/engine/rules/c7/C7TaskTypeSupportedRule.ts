import { defineRule, ERROR_TYPES, type ModdleElement } from '../CamundaRule.js';
import { C7ExecutableRule } from './C7ExecutableRule.js';
import { ImplementationHost } from './support/ImplementationHost.js';

/**
 * A camunda:type on a task or a message throw event other than external or shell.
 * Camunda 7 refuses to deploy the file; the standard engine distributions cannot load the mail
 * task either.
 *
 * @example a mail task
 * <bpmn:sendTask id="Notify" camunda:type="mail" />  <!-- camunda:type="external" -->
 */
class C7TaskTypeSupportedRule extends C7ExecutableRule {
  protected checkNode(node: ModdleElement): void {
    for (const host of ImplementationHost.forElement(node)) {
      if (!host.hasUnsupportedType) continue;
      const { prefix, command, label } = host;
      const mail = host.type!.toLowerCase() === 'mail' ? ' (the standard engine distributions cannot load the mail task)' : '';
      this.report(node, `${prefix}:type="${host.type}" on ${label} is not supported (only "external" and "shell")${mail}; the engines refuse the file`, { path: host.pathTo('type'), type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED, node: host.element, property: 'type', hint: `Use an external task: ${command.of(`${prefix}:type=external`, `${prefix}:topic=<topic>`)}, or remove it: ${command.of(`${prefix}:type=`)}.` });
    }
  }
}

export default defineRule({ ruleName: 'c7-task-type-supported', code: 'W_C7_DEPLOY_IMPLEMENTATION', impact: 'deploy' }, C7TaskTypeSupportedRule);
