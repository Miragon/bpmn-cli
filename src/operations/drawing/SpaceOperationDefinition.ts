import { FieldValues, OperationDefinition, OperationField, type OperationCheck, type OperationOf } from '../fields/index.js';

export type SpaceOperation = OperationOf<SpaceOperationDefinition>;

export class SpaceOperationDefinition extends OperationDefinition {
  readonly name = 'space';
  readonly description = "Diagram only: insert space right of / below an element like the modeler's space tool (= `bpmn space`).";
  readonly fields = {
    after: OperationField.optional(FieldValues.reference, 'Insert horizontal space right of this element (everything starting right of it moves right, frames grow).'),
    below: OperationField.optional(FieldValues.reference, 'Insert vertical space below this element (everything starting below it moves down, frames grow).'),
    by: OperationField.optional(FieldValues.size, 'How much: "column" (one node width plus gap, default for `after`), "row" (one row, default for `below`), a number of them ("2col", "2columns", "3rows") or pixels (an integer >= 1, "80px"). Negative ("-column", "-2col", "-row", an integer <= -1) closes up to that much empty space instead (only as far as it is empty). The result notes the distance moved.'),
  };
  override readonly referenceKeys = ['after', 'below'];
  override readonly schemaRules = [{ oneOf: [{ required: ['after'] }, { required: ['below'] }] }];

  protected override check(operation: OperationCheck): void {
    operation.groups([['after', 'below']], (key) => `give ${key('after')} (horizontal space right of an element) or ${key('below')} (vertical space below it)`);
  }
}
