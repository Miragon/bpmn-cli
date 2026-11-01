import { FieldSets, OperationDefinition, OperationField, type OperationCheck, type ValuesOf } from '../fields/index.js';
import { type SplitNode, SplitNodeDefinition } from './SplitNodeDefinition.js';

export type SplitBranch = ValuesOf<SplitBranchDefinition['fields']>;

export class SplitBranchDefinition extends OperationDefinition {
  readonly name = 'branch';
  readonly description = 'One branch of a split: flow options of the gateway -> first node flow, then the nodes.';
  readonly fields = {
    nodes: OperationField.items<SplitNode>(new SplitNodeDefinition(), 0, 'Nodes of the branch in order (each like an `add` op without placement); empty = a direct gateway -> join flow.'),
    ...FieldSets.flowIntoNode,
  };
  override readonly schemaRules = [FieldSets.noDefaultWithCondition];

  protected override check(operation: OperationCheck): void {
    operation.defaultFlow();
  }
}
