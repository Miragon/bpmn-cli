import { FieldSets, FieldValues, OperationDefinition, OperationField, type OperationCheck, type ValuesOf } from '../fields/index.js';

export type SplitNode = ValuesOf<SplitNodeDefinition['fields']>;

export class SplitNodeDefinition extends OperationDefinition {
  readonly name = 'node';
  readonly description = 'A node inside a split branch: an add op without placement (it is chained after the previous node).';
  readonly fields = {
    kind: FieldSets.kind,
    name: OperationField.optional(FieldValues.text, 'Display name. Also drives the generated id (<prefix><nameSlug> after the id conventions: userTask_checkInvoice).'),
    id: OperationField.optional(FieldValues.reference, 'Explicit id (default: an id after the id conventions, element-id-naming of the .bpmnlintrc or its defaults: <prefix><nameSlug>, unnamed elements <prefix><kindWord><Context> such as gateway_afterCheckInvoice). A later op of the batch refers to the element by this id or by an alias ("as").'),
    as: OperationField.alias('Batch alias of the new element: "$" + a name, e.g. "$check".'),
    flowAs: OperationField.alias('Batch alias of the flow into the new node (the flow the flow options describe; with "before" on a join or an unconnected node: the flow out of it).'),
    refAs: FieldSets.refAs,
    lane: OperationField.optional(FieldValues.reference, "Lane id the node is assigned to (default: the lane of the anchor / host; into a flow between two lanes: the target's after a branching source, else the anchor's, with W_LANE_INHERITED)."),
    ...FieldSets.flowIntoNode,
    set: FieldSets.elementKeys,
    process: OperationField.optional(FieldValues.reference, 'Participants: bind this existing (unbound) process instead of creating a new one.'),
    blackBox: OperationField.optional(FieldValues.flag, 'Participants: create no process (black-box pool).'),
    members: OperationField.optional(FieldValues.references(0), 'Lanes: initial member node ids. Groups (required): the elements the group is drawn around.'),
  };
  override readonly schemaRules = [FieldSets.noDefaultWithCondition];

  protected override check(operation: OperationCheck): void {
    operation.kind();
    operation.defaultFlow();
  }
}
