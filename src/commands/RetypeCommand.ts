import type { Command as CommandType } from 'commander';
import type { RetypeOp } from '../ops/types.js';
import type { RawOpts } from './CliCommand.js';
import { MutationCommand } from './MutationCommand.js';

/**
 * Changes the kind of an element, keeping its id and connections (`bpmn retype`).
 */
export class RetypeCommand extends MutationCommand {
  register(program: CommandType): void {
    this.withTriggerOptions(this.withMutationOptions(this.define(program, 'retype'))).action((file: string, id: string, kind: string, options: RawOpts) => this.run(file, id, kind, options));
  }

  private async run(file: string, id: string, kind: string, options: RawOpts): Promise<void> {
    const opts = this.mutationOptions(options);
    await this.cli.guarded(async () => {
      const op: RetypeOp = { op: 'retype', id, kind, ...this.triggerOptions(options) };
      await this.mutate(file, [op], opts);
    }, opts.json);
  }
}
