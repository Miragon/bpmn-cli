import { defineRule, ERROR_TYPES, type ModdleElement } from '../CamundaRule.js';
import { C8CompensationBoundaryRule } from './C8CompensationBoundaryRule.js';
import { FlowIndex } from './support/FlowIndex.js';

/**
 * A compensation boundary event, associated to its handler, with an outgoing sequence flow.
 * Camunda 8 reaches the handler through the association only and refuses the file. One without
 * association is the association rule's.
 *
 * @example a compensation boundary event that continues with a flow
 * <bpmn:boundaryEvent id="UndoCharge" attachedToRef="Charge"><bpmn:compensateEventDefinition /></bpmn:boundaryEvent>
 * <bpmn:sequenceFlow sourceRef="UndoCharge" targetRef="Refund" />  <!-- use the association -->
 */
class C8CompensationBoundaryNoOutgoingFlowRule extends C8CompensationBoundaryRule {
  private readonly flows = new FlowIndex();

  protected checkBoundary(event: ModdleElement, associated: boolean): void {
    const [outgoing] = associated ? this.flows.outgoing(event) : [];
    if (!outgoing) return;
    this.report(event, `Compensation boundary event ${event.id} has an outgoing sequence flow; Camunda 8 refuses the file`, { path: ['outgoing'], type: ERROR_TYPES.PROPERTY_NOT_ALLOWED, property: 'outgoing', hint: `Remove the flow (\`bpmn remove <file> ${outgoing.id} --no-bridge\`) and connect the handler instead: \`bpmn connect <file> ${event.id} <handlerId>\`.` });
  }
}

export default defineRule({ ruleName: 'c8-compensation-boundary-no-outgoing-flow', code: 'W_C8_DEPLOY_EVENT_DEFINITION', impact: 'deploy' }, C8CompensationBoundaryNoOutgoingFlowRule);
