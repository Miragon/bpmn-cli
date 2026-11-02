import { is, isAny } from 'bpmnlint-utils';
import { C8Rule, defineRule, ERROR_TYPES, type ModdleElement } from '../CamundaRule.js';
import { C8EventDefinitions } from './support/C8EventDefinitions.js';
import { ElementKinds } from '../support/ElementKinds.js';
import { EngineScope } from '../support/EngineScope.js';
import { ModdlePath } from '../support/ModdlePath.js';
import { Values } from '../support/Values.js';

/**
 * A send task or message throw event whose message has no name.
 * Camunda 8 publishes a message by its name and refuses the file.
 *
 * @example a send task whose message has no name
 * <bpmn:message id="Message_Order" />  <!-- no name -->
 * <bpmn:sendTask id="Notify" messageRef="Message_Order" />
 */
class C8ThrownMessageNeedsNameRule extends C8Rule {
  protected visit(node: ModdleElement): void {
    if (!EngineScope.C8.contains(node) || !isAny(node, ['bpmn:SendTask', 'bpmn:ThrowEvent'])) {
      return;
    }
    const holder = is(node, 'bpmn:SendTask') ? node : C8EventDefinitions.definitionOfType(node, 'bpmn:MessageEventDefinition');
    const message = holder?.messageRef;
    if (!message || Values.hasName(message)) return;
    this.report(node, `Message ${message.id} of ${ElementKinds.describe(node)} has no name; Camunda 8 refuses the file`, { path: [...ModdlePath.between(node, holder), 'messageRef', 'name'], type: ERROR_TYPES.PROPERTY_REQUIRED, node: message, requiredProperty: 'name', hint: `\`bpmn set <file> ${message.id} name=<MessageName>\`.` });
  }
}

export default defineRule({ ruleName: 'c8-thrown-message-needs-name', code: 'W_C8_DEPLOY_IMPLEMENTATION', impact: 'deploy' }, C8ThrownMessageNeedsNameRule);
