import type { Command as CommandType } from 'commander';
import type { SetProperties } from '../../../domain/commands/types.js';
import { BpmnError } from '../../../domain/document/BpmnError.js';
import type { RawOpts } from './CliCommand.js';
import { MutationCommand } from './MutationCommand.js';
import { parseKeyValues } from './utils/flags.js';

/**
 * Sets or unsets element properties given as key=value pairs (`bpmn set`).
 */
export class SetPropertiesCommand extends MutationCommand {
  register(program: CommandType): void {
    this.withMutationOptions(this.define(program, 'set').option('--unset <key>', '', (key: string, prev: string[]) => [...prev, key], [] as string[])).action(
      (file: string, id: string, keyValues: string[], options: RawOpts) => this.run(file, id, keyValues, options),
    );
  }

  private async run(file: string, id: string, keyValues: string[], options: RawOpts): Promise<void> {
    const opts = this.mutationOptions(options);
    const unset = (options['unset'] as string[]) ?? [];
    if (!keyValues.length && !unset.length) {
      throw new BpmnError('E_USAGE', 'Nothing to set: pass key=value pairs or --unset <key>', 'usage');
    }
    const command: SetProperties = { op: 'set', id, values: parseKeyValues(keyValues), ...(unset.length ? { unset } : {}) };
    await this.mutate(file, [command], opts);
  }
}
