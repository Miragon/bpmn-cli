import { is, isAny } from 'bpmnlint-utils';
import { C7Rule, defineRule, ERROR_TYPES, type ModdleElement } from '../CamundaRule.js';
import { ElementKinds } from '../support/ElementKinds.js';
import { EngineScope } from '../support/EngineScope.js';
import { C7EventDefinitions } from './support/C7EventDefinitions.js';

const ESCALATION_HOSTS = ['bpmn:SubProcess', 'bpmn:CallActivity', 'bpmn:UserTask'];

/**
 * An escalation boundary event attached to anything but a sub-process, call activity or user task.
 * Camunda 7 refuses to deploy the file.
 *
 * @example an escalation boundary event on a service task
 * <bpmn:boundaryEvent id="Late" attachedToRef="Charge"><bpmn:escalationEventDefinition /></bpmn:boundaryEvent>
 */
class C7EscalationBoundaryHostAllowedRule extends C7Rule {
  protected visit(node: ModdleElement): void {
    if (!is(node, 'bpmn:BoundaryEvent') || !EngineScope.C7.contains(node) || !new C7EventDefinitions(node).ofType('bpmn:EscalationEventDefinition')) {
      return;
    }
    const host = node.attachedToRef;
    if (!host || isAny(host, ESCALATION_HOSTS)) return;
    this.report(node, `Escalation boundary event ${node.id} is attached to ${ElementKinds.describe(host)}; the engines allow it only on sub-processes, call activities and user tasks and refuse the file`, { path: ['attachedToRef'], type: ERROR_TYPES.ATTACHED_TO_REF_ELEMENT_TYPE_NOT_ALLOWED, attachedToRef: host, hint: `Attach it elsewhere (\`bpmn move <file> ${node.id} --on <subProcessId>\`) or remove it: \`bpmn remove <file> ${node.id}\`.` });
  }
}

export default defineRule({ ruleName: 'c7-escalation-boundary-host-allowed', code: 'W_C7_DEPLOY_ESCALATION', impact: 'deploy' }, C7EscalationBoundaryHostAllowedRule);
