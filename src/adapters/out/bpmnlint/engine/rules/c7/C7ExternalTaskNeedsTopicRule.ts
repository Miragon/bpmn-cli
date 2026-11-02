import { defineRule, ERROR_TYPES, type ModdleElement } from '../CamundaRule.js';
import { C7ImplementationHostRule } from './C7ImplementationHostRule.js';
import type { ImplementationHost } from './support/ImplementationHost.js';

/**
 * An external task, or a message throw event implemented as one, without camunda:topic.
 * Camunda 7 refuses to deploy the file.
 *
 * @example an external task without topic
 * <bpmn:serviceTask id="Charge" camunda:type="external" />  <!-- camunda:topic="charge" -->
 */
class C7ExternalTaskNeedsTopicRule extends C7ImplementationHostRule {
  protected checkHost(node: ModdleElement, host: ImplementationHost): void {
    if (!host.isExternal || host.attributes.defined('topic') !== undefined) return;
    const { prefix, command, label } = host;
    this.report(node, `${label} is an external task without ${prefix}:topic; the engines refuse the file`, { path: host.pathTo('topic'), type: ERROR_TYPES.PROPERTY_REQUIRED, node: host.element, requiredProperty: 'topic', hint: `${command.of(`${prefix}:topic=<topic>`)}.` });
  }
}

export default defineRule({ ruleName: 'c7-external-task-needs-topic', code: 'W_C7_DEPLOY_EXTERNAL_TOPIC', impact: 'deploy' }, C7ExternalTaskNeedsTopicRule);
