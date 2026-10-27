import type { Command as CommandType } from 'commander';
import type { RemoveElements } from '../../../domain/commands/types.js';
import type { RawOpts } from './CliCommand.js';
import { MutationCommand } from './MutationCommand.js';

/**
 * Removes elements and bridges the gaps they leave (`bpmn remove`).
 */
export class RemoveElementsCommand extends MutationCommand {
  register(program: CommandType): void {
    this.withMutationOptions(
      this.define(program, 'remove')
        .option('--no-bridge', 'do not reconnect predecessor and successor')
        .option('--bridge-all')
        .option('--with-branch')
        .option('--if-exists'),
    ).action((file: string, ids: string[], options: RawOpts) => this.run(file, ids, options));
  }

  private async run(file: string, ids: string[], options: RawOpts): Promise<void> {
    const opts = this.mutationOptions(options);
    await this.cli.guarded(async () => {
      const op: RemoveElements = {
        op: 'remove',
        ids,
        bridge: options['bridge'] !== false,
        ...(options['bridgeAll'] ? { bridgeAll: true } : {}),
        ...(options['withBranch'] ? { withBranch: true } : {}),
        ...(options['ifExists'] ? { ifExists: true } : {}),
      };
      await this.mutate(file, [op], opts);
    }, opts.json);
  }
}
