import { is } from 'bpmnlint-utils';
import { C8Rule, type ModdleElement } from '../CamundaRule.js';
import { EngineScope } from '../support/EngineScope.js';
import { C8EventDefinitions } from './support/C8EventDefinitions.js';

/**
 * The compensation boundary events Camunda 8 runs, with whether an association connects them to
 * their handler, for the rules on how they reach it (`C8CompensationBoundaryNeedsAssociationRule`,
 * `C8CompensationBoundaryNoOutgoingFlowRule`).
 * Camunda 8 calls the handler through the association and refuses a boundary event without one or
 * with a sequence flow.
 *
 * @example a compensation boundary event with its handler
 * <bpmn:boundaryEvent id="UndoCharge" attachedToRef="Charge"><bpmn:compensateEventDefinition /></bpmn:boundaryEvent>
 * <bpmn:association sourceRef="UndoCharge" targetRef="Refund" />
 */
export abstract class C8CompensationBoundaryRule extends C8Rule {
  protected visit(event: ModdleElement): void {
    if (!is(event, 'bpmn:BoundaryEvent') || !EngineScope.C8.contains(event)) return;
    const definition = C8EventDefinitions.definitionOf(event);
    if (!definition || !is(definition, 'bpmn:CompensateEventDefinition')) return;
    const associated = (EngineScope.scopeOf(event)?.get('artifacts') ?? []).some((artifact: ModdleElement) => is(artifact, 'bpmn:Association') && artifact.get('sourceRef') === event);
    this.checkBoundary(event, associated);
  }

  protected abstract checkBoundary(event: ModdleElement, associated: boolean): void;
}
