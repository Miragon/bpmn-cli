import { type BpmnElement, Kinds } from '../../../model/index.js';
import { C8Rules } from './C8Rules.js';
import { CamundaRules } from '../rules/CamundaRules.js';
import type { RuleReporter } from '../rules/RuleReporter.js';
import { ShellWords } from '../rules/ShellWords.js';
import { TimerValue } from '../values/TimerValue.js';

export class C8TimerRules extends C8Rules {
  private static readonly EXPECTED: Record<string, string> = {
    timeDuration: 'an ISO 8601 duration (PT1H, P2D)',
    timeDate: 'an ISO 8601 date-time with offset (2030-12-31T10:00:00Z, ...+01:00)',
    timeCycle: 'a repeating interval (R/PT1H, R5/2030-01-01T08:00:00Z/P1D) or a 6-field cron expression (0 0 9 * * MON)',
  };
  private static readonly EXAMPLE: Record<string, string> = { timeDuration: 'PT1H', timeDate: '2030-12-31T10:00:00Z', timeCycle: 'R/PT1H' };

  check(element: BpmnElement, reporter: RuleReporter): void {
    for (const definition of element.list('eventDefinitions')) {
      this.checkTimer(element, definition, reporter);
    }
  }

  private static isValid(kind: string, timer: TimerValue): boolean {
    if (kind === 'timeDuration') {
      return timer.isDuration();
    }
    return kind === 'timeDate' ? timer.isDateTime() : timer.isCycle();
  }

  private static rangeProblem(kind: string, timer: TimerValue): string | undefined {
    if (kind === 'timeDate') {
      return timer.dateTimeRangeProblem();
    }
    return kind === 'timeCycle' ? timer.cycleRangeProblem() : undefined;
  }

  private checkTimer(el: BpmnElement, def: BpmnElement, reporter: RuleReporter): void {
    const label = this.describe(el);
    const kinds = CamundaRules.TIMER_ELEMENTS.filter((timerKind) => def.peek<BpmnElement>(timerKind));
    if (kinds.length !== 1) {
      if (!kinds.length) {
        reporter.deploy({ code: 'W_C8_DEPLOY_TIMER', element: el, subject: 'timer', message: `Timer of ${label} has no date, cycle or duration; Camunda 8 refuses the file`, hint: `\`bpmn set <file> ${el.id} timer=PT1H\` (a duration; R/PT1H is a cycle, an ISO date-time with offset a date).` });
      }
      return;
    }
    const kind = kinds[0]!;
    const value = (def.peek<BpmnElement>(kind)?.peek<string>('body') ?? '').trim();
    const catchEvent = el.is('bpmn:IntermediateCatchEvent');
    if (kind === 'timeCycle' && catchEvent) {
      reporter.deploy({ code: 'W_C8_DEPLOY_TIMER', element: el, subject: 'timer:cycle', message: `Timer catch event ${el.id} has a cycle; Camunda 8 allows only a duration or a date on intermediate timer catch events and refuses the file`, hint: `\`bpmn set <file> ${el.id} timer=PT1H\` (a duration, or a date-time).` });
      return;
    }
    if (kind === 'timeCycle' && this.isInterruptingCycleHost(el)) {
      reporter.deploy({ code: 'W_C8_DEPLOY_TIMER', element: el, subject: 'timer:interruptingCycle', message: `${label} is an interrupting timer with a cycle; Camunda 8 refuses interrupting cycles`, hint: `Make it non-interrupting (\`bpmn set <file> ${el.id} nonInterrupting=true\`) or use a duration (\`bpmn set <file> ${el.id} timer=PT1H\`).` });
    }
    this.checkTimerValue(el, kind, value, reporter);
  }

  private isInterruptingCycleHost(el: BpmnElement): boolean {
    return (el.is('bpmn:BoundaryEvent') || (el.is('bpmn:StartEvent') && Kinds.isEventSubProcess(el.parent as BpmnElement))) && !this.nonInterrupting(el);
  }

  private checkTimerValue(el: BpmnElement, kind: string, value: string, reporter: RuleReporter): void {
    const label = this.describe(el);
    if (this.isFeel(value) || value === '') {
      this.checkFeel(el, undefined, 'timer', `The ${kind} of ${label}`, value, `\`bpmn set <file> ${el.id} ${ShellWords.quote('timer==<FEEL expression>')}\` (check the FEEL syntax).`, reporter);
      if (value === '') {
        reporter.deploy({ code: 'W_C8_DEPLOY_TIMER', element: el, subject: 'timer:value', message: `The ${kind} of ${label} is empty; Camunda 8 refuses the file`, hint: `\`bpmn set <file> ${el.id} timer=PT1H\`.` });
      }
      return;
    }
    const timer = new TimerValue(value);
    if (C8TimerRules.isValid(kind, timer)) {
      return;
    }
    const range = C8TimerRules.rangeProblem(kind, timer);
    if (range) {
      reporter.deploy({ code: 'W_C8_DEPLOY_TIMER', element: el, subject: 'timer:value', message: `The ${kind} "${value}" of ${label} is no valid ${kind === 'timeDate' || !/^\S+( +\S+){5}$/.test(value) ? 'date-time' : 'cron expression'}: ${range}; Camunda 8 refuses the file`, hint: `\`bpmn set <file> ${el.id} ${ShellWords.quote(`timer=${C8TimerRules.EXAMPLE[kind]}`)}\` (with a value in range).` });
    } else {
      reporter.deploy({ code: 'W_C8_DEPLOY_TIMER', element: el, subject: 'timer:value', message: `The ${kind} "${value}" of ${label} is not ${C8TimerRules.EXPECTED[kind]}; Camunda 8 refuses the file`, hint: `\`bpmn set <file> ${el.id} ${ShellWords.quote(`timer=${C8TimerRules.EXAMPLE[kind]}`)}\` (or a FEEL expression: ${ShellWords.quote('timer==<expression>')} with --timer-kind ${kind.replace('time', '').toLowerCase()}).` });
    }
  }
}
