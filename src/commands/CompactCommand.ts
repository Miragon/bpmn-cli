import type { Command as CommandType } from 'commander';
import type { CompactOp } from '../ops/types.js';
import type { RawOpts } from './CliCommand.js';
import { FormatCommand } from './FormatCommand.js';

/**
 * Diagram only: closes empty rows and columns and shrinks pools, lanes
 * and sub-processes to their content (`bpmn compact`).
 */
export class CompactCommand extends FormatCommand {
  register(program: CommandType): void {
    this.withMutationOptions(this.define(program, 'compact')).action((file: string, ids: string[], options: RawOpts) => {
      const op: CompactOp = { op: 'compact', ...(ids.length ? { ids } : {}) };
      return this.runFormat(file, op, options);
    });
  }
}
