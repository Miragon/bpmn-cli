import { FieldSets, FieldValues, OperationDefinition, OperationField, type OperationCheck, type OperationOf } from '../fields/index.js';

export type RetypeOperation = OperationOf<RetypeOperationDefinition>;

export class RetypeOperationDefinition extends OperationDefinition {
  readonly name = 'retype';
  readonly description = 'Change the kind of an element, keeping id, name, flows and extensions.';
  readonly fields = {
    id: OperationField.required(FieldValues.reference, 'Element id.'),
    kind: FieldSets.kind,
    set: FieldSets.elementKeys,
    refAs: FieldSets.refAs,
  };
  override readonly referenceKeys = ['id'];

  protected override check(operation: OperationCheck): void {
    operation.kind();
  }
}
