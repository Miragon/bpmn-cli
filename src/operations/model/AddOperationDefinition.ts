import { type Family, Kinds } from '../../model/index.js';
import { FieldSets, FieldValues, OperationDefinition, OperationField, type OperationCheck, type OperationOf } from '../fields/index.js';
import { SplitNodeDefinition } from './SplitNodeDefinition.js';

export type AddOperation = OperationOf<AddOperationDefinition>;

export class AddOperationDefinition extends OperationDefinition {
  private static readonly NODE = new SplitNodeDefinition().fields;

  readonly name = 'add';
  readonly description = 'Create one element and wire it in (= `bpmn add`).';
  readonly fields = {
    kind: FieldSets.kind,
    name: AddOperationDefinition.NODE.name,
    id: AddOperationDefinition.NODE.id,
    as: AddOperationDefinition.NODE.as,
    flowAs: AddOperationDefinition.NODE.flowAs,
    outAs: OperationField.alias('Batch alias of the flow the add creates out of the new node (a splice: to the old successor; a prepend: to the anchor; else to `to`); E_USAGE when it creates none or two.'),
    refAs: FieldSets.refAs,
    ...FieldSets.placement,
    to: OperationField.optional(FieldValues.reference, 'Also connect the new node to this target (a branch that re-joins).'),
    lane: AddOperationDefinition.NODE.lane,
    ...FieldSets.flowIntoNode,
    ifAbsent: OperationField.optional(FieldValues.flag, 'With an explicit id: succeed without changes when the element already exists.'),
    set: FieldSets.elementKeys,
    process: AddOperationDefinition.NODE.process,
    blackBox: AddOperationDefinition.NODE.blackBox,
    members: AddOperationDefinition.NODE.members,
  };
  override readonly referenceKeys = ['after', 'before', 'flow', 'in', 'on', 'to', 'lane', 'process', 'members'];
  override readonly aliasKeyOfNewId = { id: 'as', flowId: 'flowAs' };
  override readonly schemaRules = [...FieldSets.placementRules, FieldSets.noDefaultWithCondition, { if: { required: ['ifAbsent'], properties: { ifAbsent: { const: true } } }, then: { required: ['id'] } }];

  protected override check(operation: OperationCheck): void {
    this.checkOutAs(operation, operation.kind());
    operation.placement();
    operation.flowIntoNode();
    if (operation.fields['ifAbsent'] === true && operation.fields['id'] === undefined) {
      throw operation.fail('"ifAbsent" needs an explicit "id" to check for', 'Add "id": "<Prefix>_<Name>" or drop ifAbsent.');
    }
  }

  private checkOutAs(operation: OperationCheck, family: Family | undefined): void {
    if (operation.fields['outAs'] === undefined) {
      return;
    }
    if (family && !Kinds.FLOW_NODE_FAMILIES.has(family)) {
      throw operation.fail(`"outAs": add ${operation.fields['kind']} creates no sequence flow out of it`, 'Drop "outAs"; name a connection with a connect op that has "as".');
    }
    if (!operation.present(['after', 'before', 'flow', 'to']).length) {
      throw operation.fail('"outAs" names the flow out of the node and needs "after", "before", "flow" or "to"', 'With "in" or "on" alone no sequence flow leaves the node; give "to", or connect the node with a connect op that has "as".');
    }
  }
}
