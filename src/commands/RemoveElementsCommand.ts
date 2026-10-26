import type { Command as CommandType } from 'commander';
import type { RemoveOp } from '../ops/types.js';
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
        .option('--bridge-all', 'a join (several incoming flows, one outgoing): connect every predecessor to the successor')
        .option('--with-branch', 'also remove the exclusive downstream path (every node only this one leads to, up to the next merge or the ends)')
        .option('--if-exists', 'ignore unknown ids'),
    ).action((file: string, ids: string[], options: RawOpts) => this.run(file, ids, options));
  }

  private async run(file: string, ids: string[], options: RawOpts): Promise<void> {
    const opts = this.mutationOptions(options);
    await this.cli.guarded(async () => {
      const op: RemoveOp = {
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
