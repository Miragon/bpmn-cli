import { FieldValues, OperationDefinition, OperationField, type OperationOf } from '../fields/index.js';

export type RouteOperation = OperationOf<RouteOperationDefinition>;

export class RouteOperationDefinition extends OperationDefinition {
  private static readonly SIDES = FieldValues.choice(['right', 'top', 'bottom', 'left']);

  readonly name = 'route';
  readonly description = 'Diagram only: route one flow again, optionally forcing the exit / entry side (= `bpmn route`).';
  readonly fields = {
    id: OperationField.required(FieldValues.reference, 'Sequence flow or message flow to route again.'),
    exit: OperationField.optional(RouteOperationDefinition.SIDES, 'Side the flow leaves its source by (default: the conventions).'),
    entry: OperationField.optional(RouteOperationDefinition.SIDES, 'Side the flow enters its target by (default: the conventions).'),
  };
  override readonly referenceKeys = ['id'];
}
