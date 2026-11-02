import { FieldValues, OperationDefinition, OperationField, type OperationOf } from '../fields/index.js';

export type TidyOperation = OperationOf<TidyOperationDefinition>;

export class TidyOperationDefinition extends OperationDefinition {
  readonly name = 'tidy';
  readonly description = 'Diagram only: remove overlaps and gaps < 20 px with minimal moves, keeping the order.';
  readonly fields = {
    ids: OperationField.optional(FieldValues.references(1), 'Only these shapes (default: every shape of every diagram).'),
  };
  override readonly referenceKeys = ['ids'];
}
