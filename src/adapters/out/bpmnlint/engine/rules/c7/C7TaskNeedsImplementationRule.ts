import { defineRule, ERROR_TYPES, type ModdleElement } from '../CamundaRule.js';
import { C7ImplementationHostRule } from './C7ImplementationHostRule.js';
import { type ImplementationHost, IMPLEMENTATIONS } from './support/ImplementationHost.js';

/**
 * A service, send or business rule task without class, expression, delegate expression, external
 * type, decision or connector.
 * Camunda 7 refuses to deploy the file.
 *
 * @example a service task without implementation
 * <bpmn:serviceTask id="Charge" />  <!-- no camunda:class, expression or type -->
 */
class C7TaskNeedsImplementationRule extends C7ImplementationHostRule {
  protected checkHost(node: ModdleElement, host: ImplementationHost): void {
    if (host.hasImplementation || host.isEvent) return;
    const { prefix, command, label } = host;
    const decision = host.readsDecisionRef ? `, ${prefix}:decisionRef=<decisionId>` : '';
    const hint = host.attributes.defined('topic') !== undefined ? `It has a ${prefix}:topic but no ${prefix}:type: ${command.of(`${prefix}:type=external`)}.` : `Give it one: ${command.of(`${prefix}:type=external`, `${prefix}:topic=<topic>`)} (or ${prefix}:delegateExpression=\${...}, ${prefix}:class=..., ${prefix}:expression=\${...}${decision}).`;
    this.report(node, `${label} has no implementation (${prefix}:class, delegateExpression, expression, type=external${host.readsDecisionRef ? ', decisionRef' : ''} or a connector); the engines refuse the file`, { path: host.pathTo('type'), type: ERROR_TYPES.PROPERTY_REQUIRED, node: host.element, requiredProperty: host.readsDecisionRef ? [...IMPLEMENTATIONS, 'decisionRef'] : IMPLEMENTATIONS, hint });
  }
}

export default defineRule({ ruleName: 'c7-task-needs-implementation', code: 'W_C7_DEPLOY_IMPLEMENTATION', impact: 'deploy' }, C7TaskNeedsImplementationRule);
