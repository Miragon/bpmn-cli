import { FieldSets, FieldValues, OperationCheck, OperationDefinition, OperationField, type OperationOf } from '../fields/index.js';

export type MoveOperation = OperationOf<MoveOperationDefinition>;

export class MoveOperationDefinition extends OperationDefinition {
  readonly name = 'move';
  readonly description = 'Relocate nodes to another place or lane (= `bpmn move`).';
  readonly fields = {
    ids: OperationField.required(FieldValues.references(1), 'Node ids to move (boundary events follow their host).'),
    ...FieldSets.placement,
    lane: OperationField.optional(FieldValues.text, "Assign the nodes to this lane; an empty string removes lane membership. Without it a node keeps its lane; one without a lane at its new place inherits like add (into a flow between two lanes: the target's after a branching source, else the anchor's, with W_LANE_INHERITED)."),
  };
  override readonly referenceKeys = ['ids', 'after', 'before', 'flow', 'in', 'lane'];
  override readonly schemaRules = [...FieldSets.placementRules, { anyOf: [...OperationCheck.PLACEMENT_KEYS, 'lane'].map((key) => ({ required: [key] })) }];

  protected override check(operation: OperationCheck): void {
    operation.placement();
    if (!operation.present([...OperationCheck.PLACEMENT_KEYS, 'lane']).length) {
      throw operation.fail('nothing to do: give a placement (after/before/flow/in) and/or "lane"');
    }
  }
}
