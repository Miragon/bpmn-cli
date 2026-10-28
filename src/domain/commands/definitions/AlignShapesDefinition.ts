import type { CommandFieldCheck } from '../CommandFieldCheck.js';
import { list, ref, str, type FieldsOf } from '../utils/field-specs.js';
import { SELECTOR_FIELDS } from '../utils/op-fields.js';
import { SELECTION_RULE } from '../utils/schema-rules.js';
import type { AlignShapes } from '../types.js';
import { EditCommandDefinition } from './EditCommandDefinition.js';

export class AlignShapesDefinition extends EditCommandDefinition<AlignShapes> {
  readonly name = 'align' as const;
  readonly description = 'Diagram only: put shapes on one row or one column (= `bpmn align`).';
  override readonly diagramCommand = true;
  readonly fields: FieldsOf<AlignShapes> = {
    ids: list('Shapes to align (each moves on its own).', { minItems: 1 }),
    ...SELECTOR_FIELDS,
    axis: str('row: same vertical centre (one horizontal line); column: same horizontal centre (one vertical line).', { required: true, values: ['row', 'column'] }),
    to: ref('Reference element that stays (default: the first id; with only kind and axis column: the rightmost one).'),
  };
  readonly referenceKeys = ['ids', 'path', 'via', 'branch', 'to'];

  override check(command: CommandFieldCheck): void {
    command.selection(true);
    if (!command.hasSelector() && (command.fields['ids'] as string[]).length < 2 && command.fields['to'] === undefined) throw command.fail('align needs two ids, or one id and "to"', 'Example: {"op":"align","ids":["Event_A","Event_B"],"axis":"column"}.');
  }

  override schemaRules(): unknown[] {
    return [SELECTION_RULE, { anyOf: [{ required: ['to'] }, { properties: { ids: { minItems: 2 } } }, { required: ['path'] }, { required: ['kind'] }, { required: ['branch'] }] }];
  }
}
