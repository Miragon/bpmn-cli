import type { Command as CommandType } from 'commander';
import type { RemoveOp } from '../ops/types.js';
import type { RawOpts } from './CliCommand.js';
import { MutationCommand } from './MutationCommand.js';

export class RemoveCommand extends MutationCommand {
  register(program: CommandType): void {
    this.withMutationOptions(
      this.define(program, 'remove')
        .option('--no-bridge', 'do not reconnect predecessor and successor')
        .option('--bridge-all', 'a join (several incoming flows, one outgoing): connect every predecessor to the successor')
        .option('--with-branch', 'also remove the exclusive downstream path (every node only this one leads to, up to the next merge or the ends)')
        .option('--if-exists', 'ignore unknown ids'),
    ).action((file: string, ids: string[], o: RawOpts) => this.run(file, ids, o));
  }

  private async run(file: string, ids: string[], o: RawOpts): Promise<void> {
    const opts = this.mutationOptions(o);
    await this.cli.guarded(async () => {
      const op: RemoveOp = {
        op: 'remove',
        ids,
        bridge: o['bridge'] !== false,
        ...(o['bridgeAll'] ? { bridgeAll: true } : {}),
        ...(o['withBranch'] ? { withBranch: true } : {}),
        ...(o['ifExists'] ? { ifExists: true } : {}),
      };
      await this.mutate(file, [op], opts);
    }, opts.json);
  }
}
