import type { Command as CommandType } from 'commander';
import type { TidyShapes } from '../../../domain/commands/types.js';
import type { RawOpts } from './CliCommand.js';
import { FormatCommand } from './FormatCommand.js';

/**
 * Diagram only: removes overlaps and small gaps with minimal moves (`bpmn tidy`).
 */
export class TidyCommand extends FormatCommand {
  register(program: CommandType): void {
    this.withMutationOptions(this.withSelectors(this.define(program, 'tidy'))).action(async (file: string, ids: string[], options: RawOpts) => {
      const command: TidyShapes = { op: 'tidy', ...this.selectorsOf(ids, options, false) };
      await this.runFormat(file, command, options);
    });
  }
}
