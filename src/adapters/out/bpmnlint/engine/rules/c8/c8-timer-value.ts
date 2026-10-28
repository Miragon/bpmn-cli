import { is } from 'bpmnlint-utils';
import { C8Rule, defineRule, describeElement, ERROR_TYPES, reportErrors, type ModdleElement, type Reporter } from '../CamundaRules.js';

import { C8EventPosition } from './events/C8EventPosition.js';
import { TimerValue } from './events/TimerValue.js';
import { sh } from '../shell.js';

const TIMER_KINDS = ['timeDate', 'timeCycle', 'timeDuration'] as const;
type TimerKind = (typeof TIMER_KINDS)[number];

const EXAMPLE: Record<TimerKind, string> = {
  timeDuration: 'PT1H',
  timeDate: '2030-12-31T10:00:00Z',
  timeCycle: 'R/PT1H',
};

const EXPECTED: Record<TimerKind, string> = {
  timeDuration: 'an ISO 8601 duration (PT1H, P2D)',
  timeDate: 'an ISO 8601 date-time with offset (2030-12-31T10:00:00Z, ...+01:00)',
  timeCycle: 'a repeating interval (R/PT1H, R5/2030-01-01T08:00:00Z/P1D) or a 6-field cron expression (0 0 9 * * MON)',
};

/**
 * Reports a timer value Camunda 8.9 refuses as it parses it: Java's Period and Duration split at an
 * upper-case T (no fractions but of seconds), date-times with offset in any letter case, repeating
 * intervals and Spring's 6-field cron, each within its range. camunda-compat's timer rule reads the
 * values with its own grammar; bpmn-cli drops its value reports for these.
 */
class C8TimerValue extends C8Rule {
  protected checkElement(node: ModdleElement, reporter: Reporter): void {
    if (!is(node, 'bpmn:Event') || !C8EventPosition.isInExecutableProcess(node)) {
      return;
    }
    (node.get('eventDefinitions') as ModdleElement[]).forEach((definition, index) => {
      if (!is(definition, 'bpmn:TimerEventDefinition')) {
        return;
      }
      const kinds = TIMER_KINDS.filter((kind) => definition.get(kind));
      if (kinds.length === 1) {
        this.checkValue(node, definition, index, kinds[0]!, reporter);
      }
    });
  }

  private checkValue(event: ModdleElement, definition: ModdleElement, index: number, kind: TimerKind, reporter: Reporter): void {
    const value = String(definition.get(kind).get('body') ?? '').trim();
    if (value.startsWith('=')) {
      return;
    }
    const problem = this.problem(event, kind, value);
    if (!problem) {
      return;
    }
    reportErrors(event, reporter, {
      message: `The ${kind}${value === '' ? '' : ` "${value}"`} of ${describeElement(event)} ${problem.text}; Camunda 8 refuses the file`,
      path: ['eventDefinitions', index, kind],
      data: { type: ERROR_TYPES.EXPRESSION_VALUE_NOT_ALLOWED, node: definition.get(kind), parentNode: event, property: 'body', hint: problem.hint },
    });
  }

  /** What is wrong with a static timer value, and the `bpmn set` that fixes it. */
  private problem(event: ModdleElement, kind: TimerKind, value: string): { text: string; hint: string } | undefined {
    if (value === '') {
      return { text: 'is empty', hint: `\`bpmn set <file> ${event.id} timer=PT1H\`.` };
    }
    const timer = new TimerValue(value);
    const ok = kind === 'timeDuration' ? timer.isDuration() : kind === 'timeDate' ? timer.isDateTime() : timer.isCycle();
    if (ok) {
      return undefined;
    }
    const range = kind === 'timeDate' ? timer.dateTimeRangeProblem() : kind === 'timeCycle' ? timer.cycleRangeProblem() : undefined;
    if (range) {
      return {
        text: `is no valid ${kind === 'timeDate' || !/^\S+( +\S+){5}$/.test(value) ? 'date-time' : 'cron expression'}: ${range}`,
        hint: `\`bpmn set <file> ${event.id} ${sh(`timer=${kind === 'timeDate' ? EXAMPLE.timeDate : EXAMPLE.timeCycle}`)}\` (with a value in range).`,
      };
    }
    return {
      text: `is not ${EXPECTED[kind]}`,
      hint: `\`bpmn set <file> ${event.id} ${sh(`timer=${EXAMPLE[kind]}`)}\` (or a FEEL expression: ${sh('timer==<expression>')} with --timer-kind ${kind.replace('time', '').toLowerCase()}).`,
    };
  }
}

export default defineRule(
  { ruleName: 'c8-timer-value', kind: 'engine-specific', targetEngine: 'c8', impact: 'deploy' }, C8TimerValue);
