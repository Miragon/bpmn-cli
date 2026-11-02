import { defineRule, ERROR_TYPES } from '../CamundaRule.js';
import { C8PublishMessageRule, type Publish } from './C8PublishMessageRule.js';

/**
 * A zeebe:publishMessage without correlationKey (one next to a zeebe:taskDefinition is the
 * implementation rule's).
 * Camunda 8 cannot tell which instance the message is for and refuses the file.
 *
 * @example a published message without correlation key
 * <bpmn:sendTask id="Notify" messageRef="Message_Order">
 *   <bpmn:extensionElements><zeebe:publishMessage /></bpmn:extensionElements>  <!-- correlationKey="=orderId" -->
 * </bpmn:sendTask>
 */
class C8PublishMessageNeedsCorrelationKeyRule extends C8PublishMessageRule {
  protected checkPublish({ node, publish, id, writtenAt, label, name, slot, withTaskDefinition }: Publish): void {
    const correlationKey: string | undefined = publish.correlationKey;
    if (withTaskDefinition || (correlationKey !== undefined && correlationKey !== '')) {
      return;
    }
    this.report(node, `The ${name} of ${label} has no correlationKey; Camunda 8 refuses the file`, { path: null, type: ERROR_TYPES.PROPERTY_REQUIRED, writtenAt, subject: 'publish:correlationKey', hint: `\`bpmn ext add <file> ${id} ${slot}${name} correlationKey==<expression>\`.` });
  }
}

export default defineRule({ ruleName: 'c8-publish-message-needs-correlation-key', code: 'W_C8_DEPLOY_MESSAGE', impact: 'deploy' }, C8PublishMessageNeedsCorrelationKeyRule);
