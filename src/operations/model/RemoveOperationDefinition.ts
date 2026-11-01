import { FieldValues, OperationDefinition, OperationField, type OperationOf } from '../fields/index.js';

export type RemoveOperation = OperationOf<RemoveOperationDefinition>;

export class RemoveOperationDefinition extends OperationDefinition {
  readonly name = 'remove';
  readonly description = 'Remove elements with cascade (= `bpmn remove`).';
  readonly fields = {
    ids: OperationField.required(FieldValues.references(1), 'Ids to remove (cascading: flows, boundary events, children, associations).'),
    bridge: OperationField.optional(FieldValues.choice(['none', 'all']), 'How the gap closes. Without it a node with one incoming and one outgoing flow is bridged, and every predecessor of a merge (several incoming, one outgoing; a parallel / inclusive join is refused: E_AMBIGUOUS_BRIDGE). "none": not at all. "all": a join (several incoming flows, one outgoing) connects every predecessor to the successor; a split (several outgoing flows) is refused (E_AMBIGUOUS_BRIDGE).'),
    withBranch: OperationField.optional(FieldValues.flag, 'Also remove the exclusive downstream path of each node or boundary event: every node only it leads to, up to the next merge with another path or the ends (a node several paths reach is refused: E_AMBIGUOUS_BRANCH). Nothing is bridged.'),
    ifExists: OperationField.optional(FieldValues.flag, 'Skip unknown ids with a note instead of failing.'),
  };
  override readonly referenceKeys = ['ids'];
}
