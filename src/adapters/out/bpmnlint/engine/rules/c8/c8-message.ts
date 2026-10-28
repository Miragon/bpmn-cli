import { is } from 'bpmnlint-utils';
import { defineRule, type ModdleElement, type Reporter, type ReportPath } from '../CamundaRules.js';

import { C8NamedSubscriptionRule } from './events/C8NamedSubscriptionRule.js';
import type { SubscriptionGroups } from './events/SubscriptionGroups.js';

/**
 * Reports message subscriptions Camunda 8 refuses to deploy: a process start event whose message
 * name is a FEEL expression, and one message name twice among the events it subscribes to together
 * (the boundary events of an activity with a receive task itself, the targets of an event-based
 * gateway, the starts of a scope's event sub-processes, the starts of a process).
 */
class C8Message extends C8NamedSubscriptionRule {
  protected readonly trigger = 'message';
  protected readonly staticNameStarts = 'process start events';
  protected override readonly duplicateHintNote = ' (and a zeebe:subscription on it)';

  protected checkSubscriber(node: ModdleElement, reporter: Reporter): void {
    if (is(node, 'bpmn:StartEvent') && is(node.$parent, 'bpmn:Process')) {
      this.checkStartName(node, reporter);
    }
  }

  protected checkScope(groups: SubscriptionGroups, scope: ModdleElement, reporter: Reporter): void {
    for (const { activity, boundaries } of groups.boundaryGroups()) {
      const waiting = is(activity, 'bpmn:ReceiveTask') ? [activity, ...boundaries] : boundaries;
      this.reportDuplicates(waiting, `on ${activity.id}`, reporter);
    }
    for (const { gateway, targets } of groups.gatewayTargets()) {
      this.reportDuplicates(targets, `after event-based gateway ${gateway.id}`, reporter);
    }
    this.reportDuplicates(
      groups.eventSubProcessStarts(),
      `in the event sub-processes of ${scope.id}`,
      reporter,
    );
    this.reportDuplicates(groups.processStarts(), `in process ${scope.id}`, reporter);
  }

  protected override referenceHolderOf(el: ModdleElement): ModdleElement | undefined {
    return is(el, 'bpmn:ReceiveTask') ? el : super.referenceHolderOf(el);
  }

  protected override referencePathOf(el: ModdleElement): ReportPath {
    return is(el, 'bpmn:ReceiveTask') ? ['messageRef'] : super.referencePathOf(el);
  }
}

export default defineRule(
  { ruleName: 'c8-message', kind: 'engine-specific', targetEngine: 'c8', impact: 'deploy' },
  C8Message,
);
