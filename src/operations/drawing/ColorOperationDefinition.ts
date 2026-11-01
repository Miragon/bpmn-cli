import { FieldSets, FieldValues, OperationDefinition, OperationField, type OperationCheck, type OperationOf } from '../fields/index.js';

export type ColorOperation = OperationOf<ColorOperationDefinition>;

export class ColorOperationDefinition extends OperationDefinition {
  readonly name = 'color';
  readonly description = 'Diagram only: colour shapes and connections with a bpmn-js colour picker colour.';
  readonly fields = {
    ids: OperationField.optional(FieldValues.references(1), 'Shapes and connections to colour.'),
    ...FieldSets.selectors,
    color: OperationField.required(FieldValues.choice(['blue', 'orange', 'green', 'red', 'purple', 'default']), 'A colour of the bpmn-js colour picker; "default" removes the colour.'),
  };
  override readonly referenceKeys = ['ids', 'path', 'branch'];
  override readonly schemaRules = [FieldSets.selectionRule];

  protected override check(operation: OperationCheck): void {
    operation.selection();
  }
}
