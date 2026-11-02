import { is } from 'bpmnlint-utils';
import { defineRule, ERROR_TYPES, type ModdleElement } from '../CamundaRule.js';
import { C7ExecutableRule } from './C7ExecutableRule.js';
import { C7AdHocSubProcess } from './support/C7AdHocSubProcess.js';
import { C7Diagram } from './support/C7Diagram.js';

/**
 * An ad-hoc sub-process with a multi-instance loop, that nothing connects.
 * The engines do not run ad-hoc sub-processes: Camunda 7 and CIB seven refuse the file (Operaton
 * deploys one with a valid loop). A connected one is the flows rule's.
 *
 * @example an ad-hoc sub-process with a loop
 * <bpmn:adHocSubProcess id="Research">
 *   <bpmn:multiInstanceLoopCharacteristics />  <!-- ENGINE-01009 -->
 * </bpmn:adHocSubProcess>
 */
class C7AdHocSubProcessNoMultiInstanceRule extends C7ExecutableRule {
  protected checkNode(node: ModdleElement): void {
    if (!is(node, 'bpmn:AdHocSubProcess') || !node.loopCharacteristics || !is(node.loopCharacteristics, 'bpmn:MultiInstanceLoopCharacteristics') || C7Diagram.of(node).operaton) {
      return;
    }
    const subProcess = new C7AdHocSubProcess(node);
    if (subProcess.isConnected) return;
    this.report(node, `Ad-hoc sub-process ${node.id} has a multi-instance loop; the engines do not run ad-hoc sub-processes, and Camunda 7 and CIB seven refuse the file (ENGINE-01009, "activity" is null)`, { path: ['loopCharacteristics'], type: ERROR_TYPES.PROPERTY_NOT_ALLOWED, property: 'loopCharacteristics', hint: `${subProcess.retypeHint}, or drop the loop: \`bpmn set <file> ${node.id} loop=none\`.` });
  }
}

export default defineRule({ ruleName: 'c7-ad-hoc-sub-process-no-multi-instance', code: 'W_C7_DEPLOY_AD_HOC_SUBPROCESS', impact: 'deploy' }, C7AdHocSubProcessNoMultiInstanceRule);
