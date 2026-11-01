import { FieldValues, OperationDefinition, OperationField, type OperationCheck, type OperationOf } from '../fields/index.js';
import { type SplitBranch, SplitBranchDefinition } from './SplitBranchDefinition.js';

export type SplitOperation = OperationOf<SplitOperationDefinition>;

export class SplitOperationDefinition extends OperationDefinition {
  readonly name = 'split';
  readonly description = 'Macro: split gateway + branches + join gateway in one step (apply only; there is no split command).';
  readonly fields = {
    after: OperationField.required(FieldValues.reference, 'Anchor id: the split gateway is placed after it (spliced into its single outgoing flow, or appended).'),
    kind: OperationField.optional(FieldValues.reference, 'Gateway kind (default exclusiveGateway).'),
    name: OperationField.optional(FieldValues.text, 'Name of the split gateway (exclusive gateways: a question, e.g. "Invoice ok?").'),
    id: OperationField.optional(FieldValues.reference, 'Explicit id of the split gateway.'),
    as: OperationField.alias('Batch alias of the split gateway.'),
    join: OperationField.optional(FieldValues.flag, 'Create a joining gateway of the same kind and connect every branch end to it (default true). A branch ending in an end event terminates there; with only one branch that continues no join is created (it runs on to the old successor).'),
    joinId: OperationField.optional(FieldValues.reference, "Explicit id of the join gateway (default <gatewayId>_join in the file's case; <gatewayId>Join under a declared camelCase / PascalCase)."),
    joinAs: OperationField.alias('Batch alias of the join gateway.'),
    joinName: OperationField.optional(FieldValues.text, 'Name of the join gateway.'),
    branches: OperationField.items<SplitBranch>(new SplitBranchDefinition(), 1, 'Branches in top-to-bottom order.'),
  };
  override readonly referenceKeys = ['after'];
  override readonly aliasKeyOfNewId = { id: 'as', joinId: 'joinAs' };

  protected override check(operation: OperationCheck): void {
    operation.kind('gateway');
  }
}
