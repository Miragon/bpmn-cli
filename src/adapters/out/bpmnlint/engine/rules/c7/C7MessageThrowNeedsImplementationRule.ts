import { defineRule, ERROR_TYPES, type ModdleElement } from '../CamundaRule.js';
import { C7ImplementationHostRule } from './C7ImplementationHostRule.js';
import { CamundaAttributes } from './support/CamundaAttributes.js';
import { type ImplementationHost, IMPLEMENTATIONS } from './support/ImplementationHost.js';

/**
 * A message throw or end event without implementation; one written on the event instead of its
 * message definition is the misplaced attribute rule's.
 * Camunda 7 deploys the file, but the event sends nothing and behaves like a none event when it
 * runs.
 *
 * @example a message end event that sends nothing
 * <bpmn:endEvent id="Notified"><bpmn:messageEventDefinition /></bpmn:endEvent>  <!-- camunda:type="external" -->
 */
class C7MessageThrowNeedsImplementationRule extends C7ImplementationHostRule {
  protected checkHost(node: ModdleElement, host: ImplementationHost): void {
    if (!host.isEvent || host.hasImplementation || this.hasMisplacedImplementation(node)) {
      return;
    }
    const { prefix, command, label } = host;
    this.report(node, `${label} has no implementation: it sends nothing and behaves like a none event at run time`, { path: host.pathTo('type'), type: ERROR_TYPES.PROPERTY_REQUIRED, node: host.element, requiredProperty: IMPLEMENTATIONS, hint: `Give it one: ${command.of(`${prefix}:type=external`, `${prefix}:topic=<topic>`)} (or ${prefix}:delegateExpression=\${...}).` });
  }

  private hasMisplacedImplementation(event: ModdleElement): boolean {
    const attributes = new CamundaAttributes(event);
    return [...IMPLEMENTATIONS, 'topic'].some((local) => attributes.any(local) !== undefined);
  }
}

export default defineRule({ ruleName: 'c7-message-throw-needs-implementation', code: 'W_C7_MESSAGE_NO_IMPLEMENTATION', impact: 'runtime' }, C7MessageThrowNeedsImplementationRule);
