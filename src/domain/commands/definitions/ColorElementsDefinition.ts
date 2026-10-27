import type { CommandFieldCheck } from '../CommandFieldCheck.js';
import { list, str, type FieldsOf } from '../utils/field-specs.js';
import { COLOR_VALUES, SELECTOR_FIELDS } from '../utils/op-fields.js';
import { SELECTION_RULE } from '../utils/schema-rules.js';
import type { ColorElements } from '../types.js';
import { EditCommandDefinition } from './EditCommandDefinition.js';

export class ColorElementsDefinition extends EditCommandDefinition<ColorElements> {
  readonly name = 'color' as const;
  readonly description = 'Diagram only: colour shapes and connections with a bpmn-js colour picker colour (= `bpmn color`).';
  override readonly diagramOnly = true;
  readonly fields: FieldsOf<ColorElements> = {
    ids: list('Shapes and connections to colour.', { minItems: 1 }),
    ...SELECTOR_FIELDS,
    color: str('A colour of the bpmn-js colour picker; "default" removes the colour.', { required: true, values: COLOR_VALUES }),
  };
  readonly referenceKeys = ['ids', 'path', 'via', 'branch'];

  override check(command: CommandFieldCheck): void {
    command.selection(true);
  }

  override schemaRules(): unknown[] {
    return [SELECTION_RULE];
  }
}
