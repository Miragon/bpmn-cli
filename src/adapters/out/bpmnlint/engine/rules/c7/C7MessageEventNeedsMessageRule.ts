import { defineRule } from '../CamundaRule.js';
import { C7EventReferenceRule, type EventReference } from './C7EventReferenceRule.js';

/**
 * A message start, intermediate catch or boundary event without message.
 * Camunda 7 refuses to deploy the file.
 *
 * @example a message catch event without message
 * <bpmn:intermediateCatchEvent id="Paid"><bpmn:messageEventDefinition /></bpmn:intermediateCatchEvent>  <!-- messageRef -->
 */
class C7MessageEventNeedsMessageRule extends C7EventReferenceRule {
  protected readonly kind = 'Message';
  protected readonly events = ['bpmn:StartEvent', 'bpmn:IntermediateCatchEvent', 'bpmn:BoundaryEvent'];

  protected checkReference(reference: EventReference): void {
    if (!reference.referenced) {
      this.reportMissing(reference, 'has no message', 'message=<MessageName>', ' (creates the bpmn:Message)');
    }
  }
}

export default defineRule({ ruleName: 'c7-message-event-needs-message', code: 'W_C7_DEPLOY_MESSAGE', impact: 'deploy' }, C7MessageEventNeedsMessageRule);
