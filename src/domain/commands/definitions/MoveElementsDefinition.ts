import type { CommandFieldCheck } from '../CommandFieldCheck.js';
import { list, str, type FieldsOf } from '../utils/field-specs.js';
import { FLOW_FIELDS, PLACEMENT_FIELDS, PLACEMENT_KEYS } from '../utils/op-fields.js';
import { placementRules, defaultRule } from '../utils/schema-rules.js';
import type { MoveElements } from '../types.js';
import { EditCommandDefinition } from './EditCommandDefinition.js';

export class MoveElementsDefinition extends EditCommandDefinition<MoveElements> {
  readonly name = 'move' as const;
  readonly description = 'Relocate nodes to another place or lane (= `bpmn move`).';
  readonly fields: FieldsOf<MoveElements> = {
    ids: list('Node ids to move (boundary events follow their host).', { required: true, minItems: 1 }),
    ...PLACEMENT_FIELDS,
    ...FLOW_FIELDS,
    lane: str('Assign the nodes to this lane; an empty string removes lane membership. Without it a node keeps its lane; one without a lane at its new place inherits like add (into a flow between two lanes: the target\'s after a branching source, else the anchor\'s, with W_LANE_INHERITED).'),
  };
  readonly referenceKeys = ['ids', 'after', 'before', 'flow', 'in', 'lane'];

  override check(command: CommandFieldCheck): void {
    command.placement();
    command.flowOptions(true);
    if (!command.present(PLACEMENT_KEYS).length && command.fields['lane'] === undefined) {
      throw command.fail('nothing to do: give a placement (after/before/flow/in) and/or "lane"');
    }
  }

  override schemaRules(): unknown[] {
    return [...placementRules(), defaultRule(), { anyOf: [...PLACEMENT_KEYS.map((key) => ({ required: [key] })), { required: ['lane'] }] }];
  }
}
