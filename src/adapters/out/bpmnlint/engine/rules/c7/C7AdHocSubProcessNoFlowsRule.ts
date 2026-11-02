import { is } from 'bpmnlint-utils';
import { defineRule, ERROR_TYPES, type ModdleElement } from '../CamundaRule.js';
import { C7ExecutableRule } from './C7ExecutableRule.js';
import { C7AdHocSubProcess } from './support/C7AdHocSubProcess.js';

/**
 * An ad-hoc sub-process with sequence flows or boundary events.
 * The engines do not run ad-hoc sub-processes: Camunda 7 refuses the file once one is connected.
 *
 * @example a connected ad-hoc sub-process
 * <bpmn:adHocSubProcess id="Research" />
 * <bpmn:sequenceFlow sourceRef="Research" targetRef="Report" />
 */
class C7AdHocSubProcessNoFlowsRule extends C7ExecutableRule {
  protected checkNode(node: ModdleElement): void {
    if (!is(node, 'bpmn:AdHocSubProcess')) return;
    const subProcess = new C7AdHocSubProcess(node);
    if (!subProcess.isConnected) return;
    const { flows, incoming, boundaryEvents } = subProcess;
    const parts = [this.listed('sequence flow', flows), this.listed('boundary event', boundaryEvents)].filter(Boolean);
    const refusal = flows.length ? `invalid ${incoming.length ? 'destination' : 'source'} '${node.id}' of sequence flow ${flows[0].id}` : 'invalid reference in boundary event';
    this.report(node, `Ad-hoc sub-process ${node.id} is connected (${parts.join(' and ')}); the engines do not run ad-hoc sub-processes and refuse the file (${refusal})`, { path: null, type: ERROR_TYPES.ELEMENT_TYPE_NOT_ALLOWED, flows, boundaryEvents, hint: `${subProcess.retypeHint}.` });
  }

  /** `sequence flows F1, F2`, or '' for none. */
  private listed(kind: string, elements: ModdleElement[]): string {
    return elements.length ? `${kind}${elements.length > 1 ? 's' : ''} ${elements.map((element) => element.id).join(', ')}` : '';
  }
}

export default defineRule({ ruleName: 'c7-ad-hoc-sub-process-no-flows', code: 'W_C7_DEPLOY_AD_HOC_SUBPROCESS', impact: 'deploy' }, C7AdHocSubProcessNoFlowsRule);
