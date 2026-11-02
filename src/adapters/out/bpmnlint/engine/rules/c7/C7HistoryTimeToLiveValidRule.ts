import { is } from 'bpmnlint-utils';
import { defineRule, ERROR_TYPES, type ModdleElement } from '../CamundaRule.js';
import { Values } from '../support/Values.js';
import { C7ExecutableRule } from './C7ExecutableRule.js';
import { C7Diagram } from './support/C7Diagram.js';
import { CamundaAttributes } from './support/CamundaAttributes.js';

const MAX_DAYS = 2147483647;

/**
 * A camunda:historyTimeToLive of a process that is no number of days or P<n>D.
 * Camunda 7 refuses to deploy the file.
 *
 * @example a history time to live in words
 * <bpmn:process id="Order" isExecutable="true" camunda:historyTimeToLive="6 months">  <!-- days: 180 -->
 */
class C7HistoryTimeToLiveValidRule extends C7ExecutableRule {
  protected checkNode(node: ModdleElement): void {
    if (!is(node, 'bpmn:Process')) return;
    const timeToLive = new CamundaAttributes(node).defined('historyTimeToLive');
    const days = Values.nonEmpty(timeToLive) ? (/^\+?(\d+)$/.exec(timeToLive) ?? /^P(\d+)D$/.exec(timeToLive)) : undefined;
    if (!Values.nonEmpty(timeToLive) || (days && Number(days[1]) <= MAX_DAYS)) {
      return;
    }
    const prefix = C7Diagram.of(node).prefix;
    this.report(node, `${prefix}:historyTimeToLive="${timeToLive}" of process ${node.id} is not a number of days (or P<n>D); the engines refuse it`, { path: ['historyTimeToLive'], type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED, property: 'historyTimeToLive', hint: `\`bpmn set <file> ${node.id} ${prefix}:historyTimeToLive=180\` (days, like Camunda Modeler; P180D works too).` });
  }
}

export default defineRule({ ruleName: 'c7-history-time-to-live-valid', code: 'W_C7_DEPLOY_HISTORY_TTL', impact: 'deploy' }, C7HistoryTimeToLiveValidRule);
