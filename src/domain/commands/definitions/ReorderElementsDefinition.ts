import type { CommandFieldCheck } from '../CommandFieldCheck.js';
import { list, ref, type FieldsOf } from '../utils/field-specs.js';
import type { ReorderElements } from '../types.js';
import { EditCommandDefinition } from './EditCommandDefinition.js';

export class ReorderElementsDefinition extends EditCommandDefinition<ReorderElements> {
  readonly name = 'order' as const;
  readonly description = 'Set the top-to-bottom order of the outgoing flows of a node, of the lanes of a pool / process / parent lane, or of the pools of a collaboration (= `bpmn order`).';
  readonly fields: FieldsOf<ReorderElements> = {
    id: ref('Node whose outgoing flows are ordered, the process / participant / parent lane whose lanes are ordered, or the collaboration whose pools are ordered.', { required: true }),
    flows: list('Outgoing flow ids in the wanted top-to-bottom order; unlisted flows follow in their old order.', { minItems: 1 }),
    lanes: list('Lane ids (direct child lanes of `id`) in the wanted top-to-bottom order; unlisted lanes follow in their old order. The diagram bands are reordered too.', { minItems: 1 }),
    pools: list('Participant ids (pools of the collaboration `id`, black boxes included) in the wanted top-to-bottom order; unlisted pools follow in their old order. The pool bands are reordered with their content, message flows are routed again.', { minItems: 1 }),
  };
  readonly referenceKeys = ['id', 'flows', 'lanes', 'pools'];

  override check(command: CommandFieldCheck): void {
    const given = ['flows', 'lanes', 'pools'].filter((givenKey) => command.fields[givenKey] !== undefined);
    if (given.length !== 1) {
      throw command.fail(`give exactly one of "flows" (outgoing flows of a node), "lanes" (lanes of a pool / process / parent lane) or "pools" (participants of a collaboration)`, 'Example: {"op":"order","id":"Gateway_Ok","flows":["Flow_OkToFix","Flow_OkToBook"]}, {"op":"order","id":"Participant_X","lanes":["Lane_B","Lane_A"]} or {"op":"order","id":"Collaboration_X","pools":["Participant_Customer","Participant_X"]}.');
    }
  }

  override schemaRules(): unknown[] {
    return [{ oneOf: [{ required: ['flows'] }, { required: ['lanes'] }, { required: ['pools'] }] }];
  }
}
