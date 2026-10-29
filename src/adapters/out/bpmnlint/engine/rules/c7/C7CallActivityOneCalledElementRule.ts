import { is } from 'bpmnlint-utils';
import { defineRule, ERROR_TYPES, type ModdleElement } from '../CamundaRule.js';
import { C7ExecutableRule } from './C7ExecutableRule.js';
import { C7Diagram } from './support/C7Diagram.js';
import { CamundaAttributes } from './support/CamundaAttributes.js';

/**
 * A call activity with neither calledElement nor camunda:caseRef, or with both.
 * Camunda 7 calls exactly one process or case and refuses to deploy the file.
 *
 * @example a call activity that calls nothing
 * <bpmn:callActivity id="Ship" />  <!-- calledElement="shipping" -->
 */
class C7CallActivityOneCalledElementRule extends C7ExecutableRule {
  protected checkNode(node: ModdleElement): void {
    if (!is(node, 'bpmn:CallActivity')) return;
    const prefix = C7Diagram.of(node).prefix;
    const caseRef = new CamundaAttributes(node).defined('caseRef');
    const calledElement: string | undefined = node.get('calledElement');
    if (calledElement === undefined && caseRef === undefined) {
      this.report(node, `Call activity ${node.id} has no calledElement (nor ${prefix}:caseRef); the engines refuse the file`, { path: ['calledElement'], type: ERROR_TYPES.PROPERTY_REQUIRED, requiredProperty: 'calledElement', hint: `\`bpmn set <file> ${node.id} calledElement=<processId>\`.` });
    } else if (calledElement !== undefined && caseRef !== undefined) {
      this.report(node, `Call activity ${node.id} has both calledElement and ${prefix}:caseRef; the engines refuse the file`, { path: ['caseRef'], type: ERROR_TYPES.PROPERTY_NOT_ALLOWED, property: 'caseRef', hint: `Keep one: \`bpmn set <file> ${node.id} ${prefix}:caseRef=\`.` });
    }
  }
}

export default defineRule({ ruleName: 'c7-call-activity-one-called-element', code: 'W_C7_DEPLOY_CALLED_ELEMENT', impact: 'deploy' }, C7CallActivityOneCalledElementRule);
