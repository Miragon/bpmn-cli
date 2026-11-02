import { is } from 'bpmnlint-utils';
import { defineRule, type ModdleElement } from '../CamundaRule.js';
import type { C8SubscriptionGroups } from './support/C8SubscriptionGroups.js';
import { C8SubscriptionUniqueRule } from './C8SubscriptionUniqueRule.js';

/**
 * One static message name twice among the boundary events and receive task of an activity, the
 * branches of an event-based gateway, the event sub-process starts of a scope or the process start
 * events.
 * Camunda 8 cannot tell which of them a message is for and refuses the file.
 *
 * @example two boundary events of one task waiting for the same message
 * <bpmn:boundaryEvent attachedToRef="Pay"><bpmn:messageEventDefinition messageRef="Cancel" /></bpmn:boundaryEvent>
 * <bpmn:boundaryEvent attachedToRef="Pay"><bpmn:messageEventDefinition messageRef="Cancel" /></bpmn:boundaryEvent>  <!-- same message -->
 */
class C8MessageSubscriptionUniqueRule extends C8SubscriptionUniqueRule {
  protected checkScope(groups: C8SubscriptionGroups, scope: ModdleElement): void {
    const note = ' (and a zeebe:subscription on it)';
    for (const { activity, boundaries } of groups.boundaryGroups) {
      this.reportNamed('message', is(activity, 'bpmn:ReceiveTask') ? [activity, ...boundaries] : boundaries, `on ${activity.id}`, note);
    }
    for (const { gateway, targets } of groups.gatewayTargets) {
      this.reportNamed('message', targets, `after event-based gateway ${gateway.id}`, note);
    }
    this.reportNamed('message', groups.eventSubProcessStarts, `in the event sub-processes of ${scope.id}`, note);
    this.reportNamed('message', groups.processStarts, `in process ${scope.id}`, note);
  }
}

export default defineRule({ ruleName: 'c8-message-subscription-unique', code: 'W_C8_DEPLOY_MESSAGE', impact: 'deploy' }, C8MessageSubscriptionUniqueRule);
