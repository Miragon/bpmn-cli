import type { Command as CommandType } from 'commander';
import type { CompactOp } from '../ops/types.js';
import type { RawOpts } from './CliCommand.js';
import { FormatCommand } from './FormatCommand.js';

export class CompactCommand extends FormatCommand {
  register(program: CommandType): void {
    this.withMutationOptions(this.define(program, 'compact')).action((file: string, ids: string[], o: RawOpts) => {
      const op: CompactOp = { op: 'compact', ...(ids.length ? { ids } : {}) };
      return this.runFormat(file, op, o);
    });
  }
}
