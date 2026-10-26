import type { CommandFieldCheck } from '../CommandFieldCheck.js';
import { alias, ref, type FieldsOf } from '../utils/field-specs.js';
import { KIND_FIELD, REF_AS, TRIGGER_FIELDS } from '../utils/op-fields.js';
import type { ChangeElementType } from '../types.js';
import { EditCommandDefinition } from './EditCommandDefinition.js';

export class ChangeElementTypeDefinition extends EditCommandDefinition<ChangeElementType> {
  readonly name = 'retype' as const;
  readonly description = 'Change the kind of an element, keeping id, name, flows and extensions (= `bpmn retype`).';
  readonly fields: FieldsOf<ChangeElementType> = {
    id: ref('Element id.', { required: true }),
    kind: KIND_FIELD,
    ...TRIGGER_FIELDS,
    refAs: alias(REF_AS),
  };
  readonly referenceKeys = ['id'];

  override check(command: CommandFieldCheck): void {
    command.kind();
  }
}
