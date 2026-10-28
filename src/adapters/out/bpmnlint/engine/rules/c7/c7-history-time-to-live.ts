import { is } from 'bpmnlint-utils';
import { defineRule, ERROR_TYPES, reportErrors, type ModdleElement, type Reporter } from '../CamundaRules.js';

import { C7ExecutableRule } from './implementation/C7ExecutableRule.js';
import { CamundaAttributes } from './implementation/CamundaAttributes.js';
import { nonEmpty } from './implementation/utils/values.js';
import { C7Diagram } from './C7Diagram.js';

const MAX_DAYS = 2147483647;

/**
 * Reports a `camunda:historyTimeToLive` that is not a number of days (or `P<n>D`), which Camunda 7
 * refuses to deploy. A missing one is camunda-compat's `history-time-to-live`.
 */
class C7HistoryTimeToLive extends C7ExecutableRule {
  protected checkExecutable(node: ModdleElement, reporter: Reporter): void {
    if (!is(node, 'bpmn:Process')) {
      return;
    }
    const timeToLive = new CamundaAttributes(node).defined('historyTimeToLive');
    if (!nonEmpty(timeToLive) || this.isDayCount(timeToLive)) {
      return;
    }
    const prefix = C7Diagram.of(node).prefix;
    reportErrors(node, reporter, {
      message: `${prefix}:historyTimeToLive="${timeToLive}" of process ${node.id} is not a number of days (or P<n>D); the engines refuse it`,
      path: ['historyTimeToLive'],
      data: {
        type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED,
        node,
        parentNode: null,
        property: 'historyTimeToLive',
        hint: `\`bpmn set <file> ${node.id} ${prefix}:historyTimeToLive=180\` (days, like Camunda Modeler; P180D works too).`,
      },
    });
  }

  private isDayCount(timeToLive: string): boolean {
    const days = /^\+?(\d+)$/.exec(timeToLive) ?? /^P(\d+)D$/.exec(timeToLive);
    return !!days && Number(days[1]) <= MAX_DAYS;
  }
}

export default defineRule(
  { ruleName: 'c7-history-time-to-live', kind: 'engine-specific', targetEngine: 'c7', impact: 'deploy' },
  C7HistoryTimeToLive,
);
