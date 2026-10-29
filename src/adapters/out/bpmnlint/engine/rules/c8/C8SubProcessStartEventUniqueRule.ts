import { is } from 'bpmnlint-utils';
import { C8Rule, defineRule, ERROR_TYPES, type ModdleElement } from '../CamundaRule.js';
import { EngineScope } from '../support/EngineScope.js';

/**
 * A sub-process or event sub-process with more than one start event (one without is bpmnlint's
 * `start-event-required`).
 * Camunda 8 needs exactly one start event in a sub-process and refuses the file.
 *
 * @example a sub-process with two start events
 * <bpmn:subProcess id="Review">
 *   <bpmn:startEvent id="Begin" />
 *   <bpmn:startEvent id="BeginToo" />  <!-- one too many -->
 * </bpmn:subProcess>
 */
class C8SubProcessStartEventUniqueRule extends C8Rule {
  protected visit(subProcess: ModdleElement): void {
    if (!EngineScope.C8.contains(subProcess) || !is(subProcess, 'bpmn:SubProcess') || is(subProcess, 'bpmn:AdHocSubProcess')) {
      return;
    }
    const starts = (subProcess.get('flowElements') ?? []).filter((element: ModdleElement) => is(element, 'bpmn:StartEvent'));
    if (starts.length < 2) return;
    this.report(subProcess, `${EngineScope.isEventSubProcess(subProcess) ? 'Event sub-process' : 'Sub-process'} ${subProcess.id} has ${starts.length} start events; Camunda 8 needs exactly one and refuses the file`, { path: ['flowElements'], type: ERROR_TYPES.ELEMENT_MULTIPLE_NOT_ALLOWED, hint: `Keep one: \`bpmn remove <file> ${starts[1].id}\`.` });
  }
}

export default defineRule({ ruleName: 'c8-sub-process-start-event-unique', code: 'W_C8_DEPLOY_START_EVENT', impact: 'deploy' }, C8SubProcessStartEventUniqueRule);
