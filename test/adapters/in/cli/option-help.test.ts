/**
 * Every option of an edit command that names a field of its definition says what the field
 * says: `--help`, the guide and the ops schema cannot drift apart.
 */
import { describe, expect, it } from 'vitest';
import { Cli } from '../../../../src/adapters/in/cli/Cli.js';
import { EditCommandDefinitions } from '../../../../src/domain/commands/definitions/EditCommandDefinitions.js';
import { FILE_USE_CASES } from '../../../helpers/helpers.js';

describe('CLI options of the edit commands', () => {
  const commands = new Cli('test', FILE_USE_CASES).program.commands.filter((command) => EditCommandDefinitions.find(command.name()));

  it('covers a command per edit command definition with a CLI form', () => {
    expect(commands.map((command) => command.name())).toEqual(expect.arrayContaining(['add', 'connect', 'set', 'align', 'color', 'place', 'tidy']));
  });

  it('take help and choices from the definition fields', () => {
    for (const command of commands) {
      const fields = EditCommandDefinitions.of(command.name() as never).fields;
      for (const option of command.options) {
        const spec = option.negate ? undefined : fields[option.attributeName()];
        if (!spec) continue;
        expect(option.description, `${command.name()} ${option.long}`).toBe(spec.description);
        if (spec.values) {
          expect(option.argChoices, `${command.name()} ${option.long}`).toEqual([...spec.values]);
        }
      }
    }
  });
});
