import { is } from 'bpmnlint-utils';
import { C8Rule, defineRule, ERROR_TYPES, type ModdleElement } from '../CamundaRule.js';
import { ElementKinds } from '../support/ElementKinds.js';
import { EngineScope } from '../support/EngineScope.js';
import { C8EventDefinitions } from './support/C8EventDefinitions.js';

/**
 * A non-interrupting error boundary event or error start event of an event sub-process.
 * Error events always interrupt in Camunda 8, which refuses the file.
 *
 * @example a non-interrupting error boundary event
 * <bpmn:boundaryEvent id="Failed" attachedToRef="Pay" cancelActivity="false">
 *   <bpmn:errorEventDefinition errorRef="Declined" />
 * </bpmn:boundaryEvent>
 */
class C8ErrorEventInterruptingRule extends C8Rule {
  protected visit(event: ModdleElement): void {
    if (!EngineScope.C8.contains(event) || !is(event, 'bpmn:CatchEvent') || is(event, 'bpmn:IntermediateCatchEvent')) {
      return;
    }
    const interrupting = is(event, 'bpmn:BoundaryEvent') ? 'cancelActivity' : 'isInterrupting';
    if (!C8EventDefinitions.definitionOfType(event, 'bpmn:ErrorEventDefinition') || event.get(interrupting) !== false) {
      return;
    }
    this.report(event, `${ElementKinds.describe(event)} is a non-interrupting error event; Camunda 8 refuses it (error events always interrupt)`, { path: [interrupting], type: ERROR_TYPES.PROPERTY_VALUE_NOT_ALLOWED, property: interrupting, hint: `\`bpmn set <file> ${event.id} nonInterrupting=false\`.` });
  }
}

export default defineRule({ ruleName: 'c8-error-event-interrupting', code: 'W_C8_DEPLOY_ERROR', impact: 'deploy' }, C8ErrorEventInterruptingRule);
