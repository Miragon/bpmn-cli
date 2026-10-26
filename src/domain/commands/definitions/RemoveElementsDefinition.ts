import { bool, list, type FieldsOf } from '../utils/field-specs.js';
import type { RemoveElements } from '../types.js';
import { EditCommandDefinition } from './EditCommandDefinition.js';

export class RemoveElementsDefinition extends EditCommandDefinition<RemoveElements> {
  readonly name = 'remove' as const;
  readonly description = 'Remove elements with cascade (= `bpmn remove`).';
  readonly fields: FieldsOf<RemoveElements> = {
    ids: list('Ids to remove (cascading: flows, boundary events, children, associations).', { required: true, minItems: 1 }),
    bridge: bool('Reconnect predecessor and successor when a node with one incoming and one outgoing flow is removed, every predecessor of a merge (several incoming, one outgoing; a parallel / inclusive join is refused: E_AMBIGUOUS_BRIDGE) (default true).'),
    bridgeAll: bool('A join (several incoming flows, one outgoing): connect every predecessor to the successor. A split (several outgoing flows) is refused (E_AMBIGUOUS_BRIDGE).'),
    withBranch: bool('Also remove the exclusive downstream path of each node or boundary event: every node only it leads to, up to the next merge with another path or the ends (a node several paths reach is refused: E_AMBIGUOUS_BRANCH). Nothing is bridged.'),
    ifExists: bool('Skip unknown ids with a note instead of failing.'),
  };
  readonly referenceKeys = ['ids'];
}
