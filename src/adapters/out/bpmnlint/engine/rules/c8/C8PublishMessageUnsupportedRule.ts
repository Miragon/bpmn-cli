import { defineRule, ERROR_TYPES } from '../CamundaRule.js';
import { C8PublishMessageRule, type Publish } from './C8PublishMessageRule.js';

/**
 * A zeebe:publishMessage that Camunda 8.9 deploys and does not run (one next to a
 * zeebe:taskDefinition is the implementation rule's).
 * A send task gets an incident, as only job worker send tasks are supported; a message throw or
 * end event completes without sending anything.
 *
 * @example a send task that publishes its message
 * <bpmn:sendTask id="Notify" messageRef="Message_Order">
 *   <bpmn:extensionElements><zeebe:publishMessage correlationKey="=orderId" /></bpmn:extensionElements>  <!-- zeebe:taskDefinition -->
 * </bpmn:sendTask>
 */
class C8PublishMessageUnsupportedRule extends C8PublishMessageRule {
  protected checkPublish({ node, id, writtenAt, label, name, slot, withTaskDefinition, send }: Publish, prefix: string): void {
    if (withTaskDefinition) return;
    this.report(node, `${label} publishes its message with ${name}: Camunda 8.9 accepts the file but does not run it (${send ? 'the instance gets an incident: only job worker send tasks are supported' : 'the event completes without sending anything'})`, { path: null, type: ERROR_TYPES.EXTENSION_ELEMENT_NOT_ALLOWED, writtenAt, subject: 'publishMessage', hint: `Use a job worker: \`bpmn ext remove <file> ${id} ${slot}${name}\`, then \`bpmn ext add <file> ${id} ${prefix}:taskDefinition type=<jobType>\`.` });
  }
}

export default defineRule({ ruleName: 'c8-publish-message-unsupported', code: 'W_C8_UNSUPPORTED_IMPLEMENTATION', impact: 'runtime' }, C8PublishMessageUnsupportedRule);
