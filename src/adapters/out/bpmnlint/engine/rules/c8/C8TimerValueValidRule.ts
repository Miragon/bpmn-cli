import { is } from 'bpmnlint-utils';
import { C8Rule, defineRule, ERROR_TYPES, type ModdleElement } from '../CamundaRule.js';
import { ElementKinds } from '../support/ElementKinds.js';
import { EngineScope } from '../support/EngineScope.js';
import { Shell } from '../support/Shell.js';
import { TimerValue } from './support/TimerValue.js';

const TIMER_KINDS = ['timeDate', 'timeCycle', 'timeDuration'] as const;
type TimerKind = (typeof TIMER_KINDS)[number];
const TIMER_EXAMPLE: Record<TimerKind, string> = { timeDuration: 'PT1H', timeDate: '2030-12-31T10:00:00Z', timeCycle: 'R/PT1H' };
const TIMER_EXPECTED: Record<TimerKind, string> = {
  timeDuration: 'an ISO 8601 duration (PT1H, P2D)',
  timeDate: 'an ISO 8601 date-time with offset (2030-12-31T10:00:00Z, ...+01:00)',
  timeCycle: 'a repeating interval (R/PT1H, R5/2030-01-01T08:00:00Z/P1D) or a 6-field cron expression (0 0 9 * * MON)',
};
const TIMER_CHECKS: Record<TimerKind, { valid: (timer: TimerValue) => boolean; range: (timer: TimerValue) => string | undefined }> = {
  timeDuration: { valid: (timer) => timer.isDuration(), range: () => undefined },
  timeDate: { valid: (timer) => timer.isDateTime(), range: (timer) => timer.dateTimeRangeProblem() },
  timeCycle: { valid: (timer) => timer.isCycle(), range: (timer) => timer.cycleRangeProblem() },
};

/**
 * A static timer value that is empty, no ISO 8601 date, duration or cycle nor a 6-field cron
 * expression, or out of range.
 * Camunda 8.9 parses Java's Period and Duration split at an upper-case T, date-times with offset,
 * repeating intervals and Spring's 6-field cron, each within its range, and refuses the file
 * otherwise. A FEEL value (=...) is left to the FEEL rules.
 *
 * @example a timer duration in words
 * <bpmn:timerEventDefinition>
 *   <bpmn:timeDuration>1 hour</bpmn:timeDuration>  <!-- ISO 8601: PT1H -->
 * </bpmn:timerEventDefinition>
 */
class C8TimerValueValidRule extends C8Rule {
  protected visit(event: ModdleElement): void {
    if (is(event, 'bpmn:Event') && EngineScope.inExecutableProcess(event)) {
      (event.get('eventDefinitions') as ModdleElement[]).forEach((definition, index) => this.checkTimer(event, definition, index));
    }
  }

  private checkTimer(event: ModdleElement, definition: ModdleElement, index: number): void {
    const kinds = is(definition, 'bpmn:TimerEventDefinition') ? TIMER_KINDS.filter((timerKind) => definition.get(timerKind)) : [];
    const [kind] = kinds;
    if (kinds.length !== 1 || !kind) return;
    const value = String(definition.get(kind).get('body') ?? '').trim();
    const problem = value.startsWith('=') ? undefined : this.timerProblem(event, kind, value);
    if (problem) {
      this.report(event, `The ${kind}${value === '' ? '' : ` "${value}"`} of ${ElementKinds.describe(event)} ${problem.text}; Camunda 8 refuses the file`, { path: ['eventDefinitions', index, kind], type: ERROR_TYPES.EXPRESSION_VALUE_NOT_ALLOWED, node: definition.get(kind), property: 'body', hint: problem.hint });
    }
  }

  /** What is wrong with a static timer value, and the `bpmn set` that fixes it. */
  private timerProblem(event: ModdleElement, kind: TimerKind, value: string): { text: string; hint: string } | undefined {
    if (value === '') {
      return { text: 'is empty', hint: `\`bpmn set <file> ${event.id} timer=PT1H\`.` };
    }
    const timer = new TimerValue(value);
    if (TIMER_CHECKS[kind].valid(timer)) return undefined;
    const range = TIMER_CHECKS[kind].range(timer);
    if (range) {
      return { text: `is no valid ${kind === 'timeDate' || !/^\S+( +\S+){5}$/.test(value) ? 'date-time' : 'cron expression'}: ${range}`, hint: `\`bpmn set <file> ${event.id} ${Shell.quote(`timer=${kind === 'timeDate' ? TIMER_EXAMPLE.timeDate : TIMER_EXAMPLE.timeCycle}`)}\` (with a value in range).` };
    }
    return { text: `is not ${TIMER_EXPECTED[kind]}`, hint: `\`bpmn set <file> ${event.id} ${Shell.quote(`timer=${TIMER_EXAMPLE[kind]}`)}\` (or a FEEL expression: ${Shell.quote('timer==<expression>')} with --timer-kind ${kind.replace('time', '').toLowerCase()}).` };
  }
}

export default defineRule({ ruleName: 'c8-timer-value-valid', code: 'W_C8_DEPLOY_TIMER', impact: 'deploy' }, C8TimerValueValidRule);
