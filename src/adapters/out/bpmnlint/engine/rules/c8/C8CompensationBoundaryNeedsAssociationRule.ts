import { defineRule, ERROR_TYPES, type ModdleElement } from '../CamundaRule.js';
import { C8CompensationBoundaryRule } from './C8CompensationBoundaryRule.js';

/**
 * A compensation boundary event without an association to its compensation handler.
 * Camunda 8 has no handler to call and refuses the file.
 *
 * @example a compensation boundary event without handler
 * <bpmn:boundaryEvent id="UndoCharge" attachedToRef="Charge">
 *   <bpmn:compensateEventDefinition />  <!-- no bpmn:association to a handler -->
 * </bpmn:boundaryEvent>
 */
class C8CompensationBoundaryNeedsAssociationRule extends C8CompensationBoundaryRule {
  protected checkBoundary(event: ModdleElement, associated: boolean): void {
    if (associated) return;
    this.report(event, `Compensation boundary event ${event.id} has no association to a compensation handler; Camunda 8 refuses the file`, { path: null, type: ERROR_TYPES.CHILD_ELEMENT_OF_TYPE_REQUIRED, requiredType: 'bpmn:Association', hint: `Connect it to its handler (an activity with isForCompensation=true): \`bpmn connect <file> ${event.id} <handlerId>\`.` });
  }
}

export default defineRule({ ruleName: 'c8-compensation-boundary-needs-association', code: 'W_C8_DEPLOY_EVENT_DEFINITION', impact: 'deploy' }, C8CompensationBoundaryNeedsAssociationRule);
