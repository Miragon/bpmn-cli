import { defineRule, type ModdleElement } from '../CamundaRule.js';
import type { C8SubscriptionGroups } from './support/C8SubscriptionGroups.js';
import { C8SubscriptionUniqueRule } from './C8SubscriptionUniqueRule.js';

/**
 * One static signal name twice among the boundary events of an activity or the process start
 * events.
 * Camunda 8 cannot tell which of them a signal is for and refuses the file.
 *
 * @example two process start events waiting for the same signal
 * <bpmn:startEvent id="A"><bpmn:signalEventDefinition signalRef="Go" /></bpmn:startEvent>
 * <bpmn:startEvent id="B"><bpmn:signalEventDefinition signalRef="Go" /></bpmn:startEvent>  <!-- same signal -->
 */
class C8SignalSubscriptionUniqueRule extends C8SubscriptionUniqueRule {
  protected checkScope(groups: C8SubscriptionGroups, scope: ModdleElement): void {
    for (const { activity, boundaries } of groups.boundaryGroups) {
      this.reportNamed('signal', boundaries, `on ${activity.id}`, '');
    }
    this.reportNamed('signal', groups.processStarts, `in process ${scope.id}`, '');
  }
}

export default defineRule({ ruleName: 'c8-signal-subscription-unique', code: 'W_C8_DEPLOY_SIGNAL', impact: 'deploy' }, C8SignalSubscriptionUniqueRule);
