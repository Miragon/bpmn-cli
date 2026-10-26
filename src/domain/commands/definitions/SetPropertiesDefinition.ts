import type { CommandFieldCheck } from '../CommandFieldCheck.js';
import { alias, list, map, ref, type FieldsOf } from '../utils/field-specs.js';
import { REF_AS } from '../utils/op-fields.js';
import type { SetProperties } from '../types.js';
import { EditCommandDefinition } from './EditCommandDefinition.js';

export class SetPropertiesDefinition extends EditCommandDefinition<SetProperties> {
  readonly name = 'set' as const;
  readonly description = 'Set or remove properties of an element (= `bpmn set`).';
  readonly fields: FieldsOf<SetProperties> = {
    id: ref('Element id.', { required: true }),
    values: map('Properties to set (`bpmn kinds` lists the keys per element family); an empty string removes the property.'),
    unset: list('Keys to remove.', { minItems: 1 }),
    refAs: alias(REF_AS),
  };
  readonly referenceKeys = ['id'];
  override readonly propertyMapKey = 'values';

  override check(command: CommandFieldCheck): void {
    const values = (command.fields['values'] as Record<string, string> | undefined) ?? {};
    const unset = (command.fields['unset'] as string[] | undefined) ?? [];
    if (!Object.keys(values).length && !unset.length) throw command.fail('nothing to do: "values" is empty and "unset" is missing', 'Example: {"op":"set","id":"Activity_X","values":{"name":"New name"}}.');
    command.fields['values'] = values;
  }

  override schemaRules(): unknown[] {
    return [{ anyOf: [{ required: ['values'] }, { required: ['unset'] }] }];
  }
}
