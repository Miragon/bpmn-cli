import { is, isAny } from 'bpmnlint-utils';
import { C8Rule, defineRule, ERROR_TYPES, type ModdleElement } from '../CamundaRule.js';
import { EngineScope } from '../support/EngineScope.js';

/**
 * A start or end event in an ad-hoc sub-process.
 * Camunda 8 activates the content of an ad-hoc sub-process without flow from a start event to an
 * end event and refuses the file. The report goes on the sub-process, with the path to the event
 * to remove.
 *
 * @example an ad-hoc sub-process with a start event
 * <bpmn:adHocSubProcess id="Research">
 *   <bpmn:startEvent id="Begin" />  <!-- not allowed here -->
 * </bpmn:adHocSubProcess>
 */
class C8AdHocSubProcessNoStartOrEndEventRule extends C8Rule {
  protected visit(subProcess: ModdleElement): void {
    if (!is(subProcess, 'bpmn:AdHocSubProcess') || !EngineScope.C8.contains(subProcess)) {
      return;
    }
    (subProcess.get('flowElements') as ModdleElement[]).forEach((child, index) => {
      if (isAny(child, ['bpmn:StartEvent', 'bpmn:EndEvent'])) {
        this.report(subProcess, `Ad-hoc sub-process ${subProcess.id} contains the ${is(child, 'bpmn:StartEvent') ? 'start' : 'end'} event ${child.id}; Camunda 8 refuses start and end events in ad-hoc sub-processes`, { path: ['flowElements', index], type: ERROR_TYPES.ELEMENT_TYPE_NOT_ALLOWED, node: child, hint: `\`bpmn remove <file> ${child.id}\`.` });
      }
    });
  }
}

export default defineRule({ ruleName: 'c8-ad-hoc-sub-process-no-start-or-end-event', code: 'W_C8_DEPLOY_AD_HOC_SUBPROCESS', impact: 'deploy' }, C8AdHocSubProcessNoStartOrEndEventRule);
