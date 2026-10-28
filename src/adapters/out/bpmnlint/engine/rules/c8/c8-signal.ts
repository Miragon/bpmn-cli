import { is } from 'bpmnlint-utils';
import { defineRule, type ModdleElement, type Reporter } from '../CamundaRules.js';

import { C8NamedSubscriptionRule } from './events/C8NamedSubscriptionRule.js';
import type { SubscriptionGroups } from './events/SubscriptionGroups.js';

/**
 * Reports signal subscriptions Camunda 8 refuses to deploy: a start event whose signal name is a
 * FEEL expression, and one signal name twice among the start events of a process or the boundary
 * events of one activity.
 */
class C8Signal extends C8NamedSubscriptionRule {
  protected readonly trigger = 'signal';
  protected readonly staticNameStarts = 'start events';

  protected checkSubscriber(node: ModdleElement, reporter: Reporter): void {
    if (is(node, 'bpmn:StartEvent')) {
      this.checkStartName(node, reporter);
    }
  }

  protected checkScope(groups: SubscriptionGroups, scope: ModdleElement, reporter: Reporter): void {
    for (const { activity, boundaries } of groups.boundaryGroups()) {
      this.reportDuplicates(boundaries, `on ${activity.id}`, reporter);
    }
    this.reportDuplicates(groups.processStarts(), `in process ${scope.id}`, reporter);
  }
}

export default defineRule(
  { ruleName: 'c8-signal', kind: 'engine-specific', targetEngine: 'c8', impact: 'deploy' },
  C8Signal,
);
