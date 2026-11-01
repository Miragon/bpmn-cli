import { type BpmnElement, Kinds } from '../../../model/index.js';
import { C8Rules } from './C8Rules.js';
import { CamundaRules } from '../rules/CamundaRules.js';
import type { RuleReporter } from '../rules/RuleReporter.js';
import { ShellWords } from '../rules/ShellWords.js';
import { TimerValue } from '../values/TimerValue.js';

export class C8TimerRules extends C8Rules {

  check(element: BpmnElement, reporter: RuleReporter): void {
    for (const definition of element.list('eventDefinitions')) {
      this.checkTimer(element, definition, reporter);
    }
  }


  private checkTimer(el: BpmnElement, def: BpmnElement, reporter: RuleReporter): void {
    const id = el.id;
    const label = this.describe(el);
    const kinds = CamundaRules.TIMER_ELEMENTS.filter((timerKind) => def.peek<BpmnElement>(timerKind));
    if (kinds.length !== 1) {
      if (!kinds.length) {
        reporter.deploy({ code: 'W_C8_DEPLOY_TIMER', element: el, subject: 'timer', message: `Timer of ${label} has no date, cycle or duration; Camunda 8 refuses the file`, hint: `\`bpmn set <file> ${id} timer=PT1H\` (a duration; R/PT1H is a cycle, an ISO date-time with offset a date).` });
      }
      return;
    }
    const kind = kinds[0]!;
    const value = (def.peek<BpmnElement>(kind)?.peek<string>('body') ?? '').trim();
    const catchEvent = el.is('bpmn:IntermediateCatchEvent');
    if (kind === 'timeCycle' && catchEvent) {
      reporter.deploy({ code: 'W_C8_DEPLOY_TIMER', element: el, subject: 'timer:cycle', message: `Timer catch event ${id} has a cycle; Camunda 8 allows only a duration or a date on intermediate timer catch events and refuses the file`, hint: `\`bpmn set <file> ${id} timer=PT1H\` (a duration, or a date-time).` });
      return;
    }
    if (kind === 'timeCycle' && (el.is('bpmn:BoundaryEvent') || (el.is('bpmn:StartEvent') && Kinds.isEventSubProcess(el.parent as BpmnElement))) && !this.nonInterrupting(el)) {
      reporter.deploy({ code: 'W_C8_DEPLOY_TIMER', element: el, subject: 'timer:interruptingCycle', message: `${label} is an interrupting timer with a cycle; Camunda 8 refuses interrupting cycles`, hint: `Make it non-interrupting (\`bpmn set <file> ${id} nonInterrupting=true\`) or use a duration (\`bpmn set <file> ${id} timer=PT1H\`).` });
    }
    if (this.isFeel(value) || value === '') {
      this.checkFeel(el, undefined, 'timer', `The ${kind} of ${label}`, value, `\`bpmn set <file> ${id} ${ShellWords.quote('timer==<FEEL expression>')}\` (check the FEEL syntax).`, reporter);
      if (value === '') {
        reporter.deploy({ code: 'W_C8_DEPLOY_TIMER', element: el, subject: 'timer:value', message: `The ${kind} of ${label} is empty; Camunda 8 refuses the file`, hint: `\`bpmn set <file> ${id} timer=PT1H\`.` });
      }
      return;
    }
    const timer = new TimerValue(value);
    const ok = kind === 'timeDuration' ? timer.isDuration() : kind === 'timeDate' ? timer.isDateTime() : timer.isCycle();
    const range = ok ? undefined : kind === 'timeDate' ? timer.dateTimeRangeProblem() : kind === 'timeCycle' ? timer.cycleRangeProblem() : undefined;
    if (range) {
      reporter.deploy({ code: 'W_C8_DEPLOY_TIMER', element: el, subject: 'timer:value', message: `The ${kind} "${value}" of ${label} is no valid ${kind === 'timeDate' || !/^\S+( +\S+){5}$/.test(value) ? 'date-time' : 'cron expression'}: ${range}; Camunda 8 refuses the file`, hint: `\`bpmn set <file> ${id} ${ShellWords.quote(`timer=${kind === 'timeDate' ? '2030-12-31T10:00:00Z' : 'R/PT1H'}`)}\` (with a value in range).` });
    } else if (!ok) {
      const expected = kind === 'timeDuration' ? 'an ISO 8601 duration (PT1H, P2D)' : kind === 'timeDate' ? 'an ISO 8601 date-time with offset (2030-12-31T10:00:00Z, ...+01:00)' : 'a repeating interval (R/PT1H, R5/2030-01-01T08:00:00Z/P1D) or a 6-field cron expression (0 0 9 * * MON)';
      reporter.deploy({ code: 'W_C8_DEPLOY_TIMER', element: el, subject: 'timer:value', message: `The ${kind} "${value}" of ${label} is not ${expected}; Camunda 8 refuses the file`, hint: `\`bpmn set <file> ${id} ${ShellWords.quote(`timer=${kind === 'timeDuration' ? 'PT1H' : kind === 'timeDate' ? '2030-12-31T10:00:00Z' : 'R/PT1H'}`)}\` (or a FEEL expression: ${ShellWords.quote('timer==<expression>')} with --timer-kind ${kind.replace('time', '').toLowerCase()}).` });
    }
  }
}
