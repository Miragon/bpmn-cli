import { defineRule } from '../CamundaRule.js';
import { C7SubscriptionUniqueRule } from './C7SubscriptionUniqueRule.js';

/**
 * One signal name twice among the events waiting in one engine scope.
 * Camunda 7 refuses two signal subscriptions with one name and does not deploy the file.
 *
 * @example two process start events waiting for the same signal
 * <bpmn:startEvent id="Alarm"><bpmn:signalEventDefinition signalRef="Fire" /></bpmn:startEvent>
 * <bpmn:startEvent id="AlarmAgain"><bpmn:signalEventDefinition signalRef="Fire" /></bpmn:startEvent>  <!-- same signal -->
 */
class C7SignalSubscriptionUniqueRule extends C7SubscriptionUniqueRule {
  protected readonly kind = 'signal';
}

export default defineRule({ ruleName: 'c7-signal-subscription-unique', code: 'W_C7_DEPLOY_SIGNAL', impact: 'deploy' }, C7SignalSubscriptionUniqueRule);
