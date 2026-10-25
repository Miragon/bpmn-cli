import type { Command as CommandType } from 'commander';
import type { RetypeOp } from '../ops/types.js';
import type { RawOpts } from './CliCommand.js';
import { MutationCommand } from './MutationCommand.js';

/**
 * Changes the kind of an element, keeping its id and connections (`bpmn retype`).
 */
export class RetypeCommand extends MutationCommand {
  register(program: CommandType): void {
    this.withTriggerOptions(this.withMutationOptions(this.define(program, 'retype'))).action((file: string, id: string, kind: string, o: RawOpts) => this.run(file, id, kind, o));
  }

  private async run(file: string, id: string, kind: string, o: RawOpts): Promise<void> {
    const opts = this.mutationOptions(o);
    await this.cli.guarded(async () => {
      const op: RetypeOp = { op: 'retype', id, kind, ...this.triggerOptions(o) };
      await this.mutate(file, [op], opts);
    }, opts.json);
  }
}
