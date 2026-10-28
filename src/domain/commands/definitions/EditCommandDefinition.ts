import type { CommandFieldCheck } from '../CommandFieldCheck.js';
import type { FieldSpec, FieldsOf } from '../utils/field-specs.js';
import type { EditCommand } from '../types.js';

export abstract class EditCommandDefinition<TCommand extends EditCommand = EditCommand> {
  abstract readonly name: TCommand['op'];
  abstract readonly description: string;
  abstract readonly fields: FieldsOf<TCommand> & Record<string, FieldSpec>;
  /** Changes only the drawing: runs after the layout of the model commands before it. */
  readonly diagramCommand: boolean = false;
  /** Keys that hold an element id (or a list of them): where an alias may stand. */
  abstract readonly referenceKeys: readonly string[];
  /** An alias in a new-id key is a mistake: the alias key it belongs in. */
  readonly aliasKeyOfNewId: Readonly<Record<string, string>> = {};
  /** The key of a property map whose `default`, `source`, `target` and `lane` values are element ids. */
  readonly propertyMapKey: string | undefined = undefined;

  check(_command: CommandFieldCheck): void {}

  schemaRules(): unknown[] {
    return [];
  }
}
