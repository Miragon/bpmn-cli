import { is } from 'bpmnlint-utils';
import { defineRule, type ModdleElement } from '../CamundaRule.js';
import { ElementKinds } from '../support/ElementKinds.js';
import { EngineScope } from '../support/EngineScope.js';
import { C7EventReferenceRule, type EventReference } from './C7EventReferenceRule.js';

/**
 * A message without name that a message start, intermediate catch or boundary event, or a receive
 * task, waits for.
 * Camunda 7 correlates messages by name and refuses to deploy the file.
 *
 * @example a message without name
 * <bpmn:message id="Payment" />  <!-- name="Payment" -->
 * <bpmn:receiveTask id="Wait" messageRef="Payment" />
 */
class C7MessageNeedsNameRule extends C7EventReferenceRule {
  protected readonly kind = 'Message';
  protected readonly events = ['bpmn:StartEvent', 'bpmn:IntermediateCatchEvent', 'bpmn:BoundaryEvent'];

  protected override visit(node: ModdleElement): void {
    super.visit(node);
    if (is(node, 'bpmn:ReceiveTask') && node.messageRef && !node.messageRef.name && EngineScope.C7.contains(node)) {
      this.reportUnnamed(node, node.messageRef, `Message ${node.messageRef.id} of receive task ${node.id}`, ['messageRef']);
    }
  }

  protected checkReference({ event, referenced, path }: EventReference): void {
    if (referenced && !referenced.name) {
      this.reportUnnamed(event, referenced, `Message ${referenced.id} of ${ElementKinds.describe(event)}`, path);
    }
  }
}

export default defineRule({ ruleName: 'c7-message-needs-name', code: 'W_C7_DEPLOY_MESSAGE', impact: 'deploy' }, C7MessageNeedsNameRule);
