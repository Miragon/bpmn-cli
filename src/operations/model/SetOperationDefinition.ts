import { FieldSets, FieldValues, OperationDefinition, OperationField, type OperationCheck, type OperationOf } from '../fields/index.js';

export type SetOperation = OperationOf<SetOperationDefinition>;

export class SetOperationDefinition extends OperationDefinition {
  readonly name = 'set';
  readonly description = 'Set or remove properties of an element (= `bpmn set`).';
  readonly fields = {
    id: OperationField.required(FieldValues.reference, 'Element id.'),
    set: OperationField.required(FieldValues.keys, 'Properties to set (`bpmn guide set-keys` lists the keys per element family); an empty string removes the property.'),
    refAs: FieldSets.refAs,
  };
  override readonly referenceKeys = ['id'];
  override readonly schemaRules = [{ properties: { set: { minProperties: 1 } } }];

  protected override check(operation: OperationCheck): void {
    if (!Object.keys(operation.fields['set'] as object).length) {
      throw operation.fail('nothing to do: "set" is empty', 'Example: {"op":"set","id":"task_x","set":{"name":"New name"}}.');
    }
  }
}
