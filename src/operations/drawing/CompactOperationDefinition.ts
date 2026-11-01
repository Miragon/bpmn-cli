import { FieldValues, OperationDefinition, OperationField, type OperationOf } from '../fields/index.js';

export type CompactOperation = OperationOf<CompactOperationDefinition>;

export class CompactOperationDefinition extends OperationDefinition {
  readonly name = 'compact';
  readonly description = 'Diagram only: close empty rows and columns and shrink pools, lanes and expanded sub-processes to their content, keeping the order and relative positions; never adds a layout problem (= `bpmn compact`).';
  readonly fields = {
    ids: OperationField.optional(FieldValues.references(1), 'Only these frames (pools by participant id, lanes, expanded sub-processes) and what is inside them (default: the whole drawing).'),
  };
  override readonly referenceKeys = ['ids'];
}
