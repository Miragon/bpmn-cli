import { FieldValues, OperationDefinition, OperationField, type OperationCheck, type OperationOf } from '../fields/index.js';

export type OrderOperation = OperationOf<OrderOperationDefinition>;

export class OrderOperationDefinition extends OperationDefinition {
  readonly name = 'order';
  readonly description = 'Set the top-to-bottom order of the outgoing flows of a node, of the lanes of a pool / process / parent lane, or of the pools of a collaboration.';
  readonly fields = {
    id: OperationField.required(FieldValues.reference, 'Node whose outgoing flows are ordered, the process / participant / parent lane whose lanes are ordered, or the collaboration whose pools are ordered.'),
    flows: OperationField.optional(FieldValues.references(1), 'Outgoing flow ids in the wanted top-to-bottom order; unlisted flows follow in their old order.'),
    lanes: OperationField.batchOnly(FieldValues.references(1), 'Lane ids (direct child lanes of `id`) in the wanted top-to-bottom order; unlisted lanes follow in their old order. The diagram bands are reordered too.'),
    pools: OperationField.batchOnly(FieldValues.references(1), 'Participant ids (pools of the collaboration `id`, black boxes included) in the wanted top-to-bottom order; unlisted pools follow in their old order. The pool bands are reordered with their content, message flows are routed again.'),
  };
  override readonly referenceKeys = ['id', 'flows', 'lanes', 'pools'];
  override readonly schemaRules = [{ oneOf: [{ required: ['flows'] }, { required: ['lanes'] }, { required: ['pools'] }] }];

  protected override check(operation: OperationCheck): void {
    if (operation.present(['flows', 'lanes', 'pools']).length !== 1) {
      throw operation.fail('give exactly one of "flows" (outgoing flows of a node), "lanes" (lanes of a pool / process / parent lane) or "pools" (participants of a collaboration)', 'Example: {"op":"order","id":"gateway_ok","flows":["flow_okToFix","flow_okToBook"]}, {"op":"order","id":"participant_x","lanes":["lane_b","lane_a"]} or {"op":"order","id":"collaboration_x","pools":["participant_customer","participant_x"]}.');
    }
  }
}
