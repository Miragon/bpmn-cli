import { FieldValues, OperationDefinition, OperationField, type OperationOf } from '../fields/index.js';

export type LabelOperation = OperationOf<LabelOperationDefinition>;

export class LabelOperationDefinition extends OperationDefinition {
  readonly name = 'label';
  readonly description = 'Diagram only: put the external label of an event, gateway, data element or flow on one side (= `bpmn label`).';
  readonly fields = {
    id: OperationField.required(FieldValues.reference, 'Event, gateway, data object / store or flow with a name (external label).'),
    side: OperationField.required(FieldValues.choice(['above', 'below', 'left', 'right']), 'Side of the element (flows: of the longest horizontal / vertical segment) the label goes to.'),
  };
  override readonly referenceKeys = ['id'];
}
