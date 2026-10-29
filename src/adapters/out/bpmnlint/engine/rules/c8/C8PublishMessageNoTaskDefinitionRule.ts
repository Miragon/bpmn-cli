import { defineRule, ERROR_TYPES } from '../CamundaRule.js';
import { C8PublishMessageRule, type Publish } from './C8PublishMessageRule.js';

/**
 * A zeebe:publishMessage next to a zeebe:taskDefinition.
 * Camunda 8 needs exactly one implementation of a send task or message throw event and refuses
 * the file.
 *
 * @example a send task with a job worker and a published message
 * <bpmn:sendTask id="Notify" messageRef="Message_Order">
 *   <bpmn:extensionElements><zeebe:taskDefinition type="notify" /><zeebe:publishMessage correlationKey="=orderId" /></bpmn:extensionElements>  <!-- keep one -->
 * </bpmn:sendTask>
 */
class C8PublishMessageNoTaskDefinitionRule extends C8PublishMessageRule {
  protected checkPublish({ node, id, writtenAt, label, name, slot, withTaskDefinition }: Publish, prefix: string): void {
    if (!withTaskDefinition) return;
    this.report(node, `${label} has both a ${prefix}:taskDefinition and a ${name}; Camunda 8 needs exactly one of them and refuses the file`, { path: null, type: ERROR_TYPES.EXTENSION_ELEMENT_NOT_ALLOWED, writtenAt, subject: 'impl:both', hint: `Keep one: \`bpmn ext remove <file> ${id} ${prefix}:taskDefinition\` (or \`bpmn ext remove <file> ${id} ${slot}${name}\`).` });
  }
}

export default defineRule({ ruleName: 'c8-publish-message-no-task-definition', code: 'W_C8_DEPLOY_IMPLEMENTATION', impact: 'deploy' }, C8PublishMessageNoTaskDefinitionRule);
