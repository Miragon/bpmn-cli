import { defineRule } from '../CamundaRule.js';
import { C7SubscriptionUniqueRule } from './C7SubscriptionUniqueRule.js';

/**
 * One message name twice among the events and receive tasks waiting in one engine scope.
 * Camunda 7 refuses two message subscriptions with one name and does not deploy the file.
 *
 * @example two boundary events of one task waiting for the same message
 * <bpmn:boundaryEvent attachedToRef="Pay"><bpmn:messageEventDefinition messageRef="Cancel" /></bpmn:boundaryEvent>
 * <bpmn:boundaryEvent attachedToRef="Pay"><bpmn:messageEventDefinition messageRef="Cancel" /></bpmn:boundaryEvent>  <!-- same message -->
 */
class C7MessageSubscriptionUniqueRule extends C7SubscriptionUniqueRule {
  protected readonly kind = 'message';
}

export default defineRule({ ruleName: 'c7-message-subscription-unique', code: 'W_C7_DEPLOY_MESSAGE', impact: 'deploy' }, C7MessageSubscriptionUniqueRule);
