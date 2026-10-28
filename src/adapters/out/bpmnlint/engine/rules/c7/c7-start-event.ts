import { is } from 'bpmnlint-utils';
import { C7Rule, defineRule, ERROR_TYPES, reportErrors, type ModdleElement, type Reporter } from '../CamundaRules.js';

import { C7EventDefinitions } from './events/C7EventDefinitions.js';
import { C7ExecutableScope } from './events/C7ExecutableScope.js';
import { C7ExtraStartHint } from './events/C7ExtraStartHint.js';
import { missingStartHint } from './events/missingStartHint.js';

/**
 * Reports the start events Camunda 7 refuses to deploy: a process or sub-process without one (an
 * empty one too), a second none or timer start event of a process, and a second start event of a
 * sub-process. A transaction without a start event and an event sub-process are left to other rules.
 */
class C7StartEvent extends C7Rule {
  protected checkElement(node: ModdleElement, reporter: Reporter): void {
    if (!is(node, 'bpmn:Process') && !is(node, 'bpmn:SubProcess')) {
      return;
    }
    if (!C7ExecutableScope.contains(node)) {
      return;
    }

    const nodes: ModdleElement[] = (node.flowElements ?? []).filter((element: ModdleElement) =>
      is(element, 'bpmn:FlowNode'),
    );
    const starts = nodes.filter((element) => is(element, 'bpmn:StartEvent'));
    if (starts.length) {
      this.checkExtraStarts(node, starts, reporter);
    } else if (!C7ExecutableScope.isEventSubProcess(node) && !is(node, 'bpmn:Transaction')) {
      this.reportMissing(node, nodes.length > 0, reporter);
    }
  }

  private reportMissing(scope: ModdleElement, hasNodes: boolean, reporter: Reporter): void {
    const isProcess = is(scope, 'bpmn:Process');
    const what = hasNodes ? 'has no start event' : 'is empty, without a start event';
    reportErrors(scope, reporter, {
      message: `${isProcess ? 'Process' : 'Sub-process'} ${scope.id} ${what}; the engines refuse the file (${isProcess ? 'process' : 'subProcess'} must define a startEvent element)`,
      path: ['flowElements'],
      data: {
        type: ERROR_TYPES.CHILD_ELEMENT_OF_TYPE_REQUIRED,
        node: scope,
        parentNode: null,
        requiredType: 'bpmn:StartEvent',
        hint: missingStartHint(scope.id, hasNodes, !isProcess),
      },
    });
  }

  /** A process allows one none or timer start event, a sub-process one start event at all. */
  private checkExtraStarts(
    scope: ModdleElement,
    starts: ModdleElement[],
    reporter: Reporter,
  ): void {
    const isProcess = is(scope, 'bpmn:Process');
    const limited = isProcess
      ? starts.filter((start) =>
          new C7EventDefinitions(start)
            .actedOn()
            .every((definition) => is(definition, 'bpmn:TimerEventDefinition')),
        )
      : starts;
    const [first, ...rest] = limited;
    for (const extra of rest) {
      const message = isProcess
        ? `Start event ${extra.id} is a second none or timer start event of process ${scope.id} (with ${first.id}); the engines allow only one and refuse the file`
        : `${this.kindOf(scope)} ${scope.id} has ${limited.length} start events (${limited.map((start) => start.id).join(', ')}); the engines allow only one in a sub-process and refuse the file`;
      reportErrors(extra, reporter, {
        message,
        path: null,
        data: {
          type: ERROR_TYPES.ELEMENT_MULTIPLE_NOT_ALLOWED,
          node: extra,
          parentNode: null,
          first,
          hint: new C7ExtraStartHint(scope, first, extra).text(),
        },
      });
    }
  }

  private kindOf(subProcess: ModdleElement): string {
    if (C7ExecutableScope.isEventSubProcess(subProcess)) {
      return 'Event sub-process';
    }
    return is(subProcess, 'bpmn:Transaction') ? 'Transaction' : 'Sub-process';
  }
}

export default defineRule(
  { ruleName: 'c7-start-event', kind: 'engine-specific', targetEngine: 'c7', impact: 'deploy' },
  C7StartEvent,
);
