import type { Command as CommandType } from 'commander';
import type { TidyOp } from '../ops/types.js';
import type { RawOpts } from './CliCommand.js';
import { FormatCommand } from './FormatCommand.js';

/**
 * Diagram only: removes overlaps and small gaps with minimal moves (`bpmn tidy`).
 */
export class TidyCommand extends FormatCommand {
  register(program: CommandType): void {
    this.withMutationOptions(this.withSelectors(this.define(program, 'tidy'), 'tidy')).action((file: string, ids: string[], o: RawOpts) =>
      this.cli.guarded(async () => {
        const op: TidyOp = { op: 'tidy', ...this.selectorsOf(ids, o, false) };
        await this.runFormat(file, op, o);
      }, !!o['json']),
    );
  }
}
