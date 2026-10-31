import { is, isAny } from 'bpmnlint-utils';
import { defineRule, ERROR_TYPES, type ModdleElement } from '../CamundaRule.js';
import { EngineScope } from '../support/EngineScope.js';
import { C7ExecutableRule } from './C7ExecutableRule.js';
import { C7EventDefinitions } from './support/C7EventDefinitions.js';
import { C7ExtraStartHint } from './support/C7ExtraStartHint.js';

/**
 * A second none or timer start event of a process, or a second start event of a sub-process.
 * Camunda 7 allows only one and refuses to deploy the file.
 *
 * @example two none start events of a process
 * <bpmn:startEvent id="Received" />
 * <bpmn:startEvent id="Entered" />  <!-- a message start event may stay -->
 */
class C7StartEventUniqueRule extends C7ExecutableRule {
  protected checkNode(scope: ModdleElement): void {
    if (!isAny(scope, ['bpmn:Process', 'bpmn:SubProcess']) || is(scope, 'bpmn:AdHocSubProcess')) {
      return;
    }
    const starts: ModdleElement[] = (scope.flowElements ?? []).filter((element: ModdleElement) => is(element, 'bpmn:FlowNode') && is(element, 'bpmn:StartEvent'));
    const isProcess = is(scope, 'bpmn:Process');
    const limited = isProcess ? starts.filter((start) => new C7EventDefinitions(start).actedOn().every((definition) => is(definition, 'bpmn:TimerEventDefinition'))) : starts;
    const [first, ...rest] = limited;
    const kind = is(scope, 'bpmn:Transaction') ? 'Transaction' : 'Sub-process';
    for (const extra of rest) {
      const message = isProcess ? `Start event ${extra.id} is a second none or timer start event of process ${scope.id} (with ${first.id}); the engines allow only one and refuse the file` : `${EngineScope.isEventSubProcess(scope) ? 'Event sub-process' : kind} ${scope.id} has ${limited.length} start events (${limited.map((start) => start.id).join(', ')}); the engines allow only one in a sub-process and refuse the file`;
      this.report(extra, message, { path: null, type: ERROR_TYPES.ELEMENT_MULTIPLE_NOT_ALLOWED, first, hint: new C7ExtraStartHint(scope, first, extra).text() });
    }
  }
}

export default defineRule({ ruleName: 'c7-start-event-unique', code: 'W_C7_DEPLOY_START_EVENT', impact: 'deploy' }, C7StartEventUniqueRule);
