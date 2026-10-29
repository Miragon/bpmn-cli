import type { Command, Option } from 'commander';
import { EditCommandDefinitions } from '../../../../domain/commands/definitions/EditCommandDefinitions.js';

function fieldKey(option: Option): string {
  return option.attributeName();
}

/**
 * Every option of an edit command that names a field of its definition takes the field's
 * description as help and its allowed values as choices, so `--help`, the guide and the ops
 * schema say the same.
 */
export function describeOptionsByDefinitions(program: Command): void {
  for (const command of program.commands) {
    const definition = EditCommandDefinitions.find(command.name());
    if (!definition) continue;
    for (const option of command.options) {
      const spec = option.negate ? undefined : definition.fields[fieldKey(option)];
      if (!spec) continue;
      option.description = spec.description;
      if (spec.values && (option.required || option.optional)) {
        option.choices(spec.values);
      }
    }
  }
}
