import type { CommandFieldCheck } from '../CommandFieldCheck.js';
import { ref, type FieldsOf } from '../utils/field-specs.js';
import type { InsertSpace } from '../types.js';
import { EditCommandDefinition } from './EditCommandDefinition.js';

export class InsertSpaceDefinition extends EditCommandDefinition<InsertSpace> {
  readonly name = 'space' as const;
  readonly description = 'Diagram only: insert space right of / below an element like the modeler\'s space tool (= `bpmn space`).';
  override readonly diagramOnly = true;
  readonly fields: FieldsOf<InsertSpace> = {
    after: ref('Insert horizontal space right of this element (everything starting right of it moves right, frames grow).'),
    below: ref('Insert vertical space below this element (everything starting below it moves down, frames grow).'),
    by: { type: 'size', description: 'How much: "column" (one node width plus gap, default for `after`), "row" (one row, default for `below`), a number of them ("2col", "2columns", "3rows") or pixels (an integer >= 1, "80px"). Negative ("-column", "-2col", "-row", an integer <= -1) closes up to that much empty space instead (only as far as it is empty). The result notes the distance moved.' },
  };
  readonly referenceKeys = ['after', 'below'];

  override check(command: CommandFieldCheck): void {
    command.groups([['after', 'below']], 'give "after" (horizontal space right of an element) or "below" (vertical space below it)');
  }

  override schemaRules(): unknown[] {
    return [{ oneOf: [{ required: ['after'] }, { required: ['below'] }] }];
  }
}
