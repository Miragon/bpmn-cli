import type { CommandFieldCheck } from '../CommandFieldCheck.js';
import { list, type FieldsOf } from '../utils/field-specs.js';
import { SELECTOR_FIELDS } from '../utils/op-fields.js';
import type { TidyShapes } from '../types.js';
import { EditCommandDefinition } from './EditCommandDefinition.js';

export class TidyShapesDefinition extends EditCommandDefinition<TidyShapes> {
  readonly name = 'tidy' as const;
  readonly description = 'Diagram only: remove overlaps and gaps < 20 px with minimal moves, keeping the order (= `bpmn tidy`, `bpmn layout --tidy`).';
  readonly fields: FieldsOf<TidyShapes> = {
    ids: list('Only these shapes (default: every shape of every diagram).', { minItems: 1 }),
    ...SELECTOR_FIELDS,
  };
  readonly referenceKeys = ['ids', 'path', 'via', 'branch'];

  override check(command: CommandFieldCheck): void {
    command.selection(false);
  }
}
