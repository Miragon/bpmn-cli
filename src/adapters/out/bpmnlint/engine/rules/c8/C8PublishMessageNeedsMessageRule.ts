import { defineRule, ERROR_TYPES } from '../CamundaRule.js';
import { C8PublishMessageRule, type Publish } from './C8PublishMessageRule.js';

/**
 * A zeebe:publishMessage whose send task or message definition references no message (one next to
 * a zeebe:taskDefinition is the implementation rule's).
 * Camunda 8 has no message to publish and refuses the file.
 *
 * @example a send task that publishes no message
 * <bpmn:sendTask id="Notify">  <!-- no messageRef -->
 *   <bpmn:extensionElements><zeebe:publishMessage correlationKey="=orderId" /></bpmn:extensionElements>
 * </bpmn:sendTask>
 */
class C8PublishMessageNeedsMessageRule extends C8PublishMessageRule {
  protected checkPublish({ node, host, id, writtenAt, label, withTaskDefinition }: Publish): void {
    if (withTaskDefinition || host.messageRef) return;
    this.report(node, `${label} publishes no message (no message reference); Camunda 8 refuses the file`, { path: null, type: ERROR_TYPES.PROPERTY_REQUIRED, writtenAt, subject: 'publish:messageRef', hint: `\`bpmn set <file> ${id} message=<MessageName>\`.` });
  }
}

export default defineRule({ ruleName: 'c8-publish-message-needs-message', code: 'W_C8_DEPLOY_MESSAGE', impact: 'deploy' }, C8PublishMessageNeedsMessageRule);
