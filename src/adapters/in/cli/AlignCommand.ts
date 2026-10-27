import { Option, type Command as CommandType } from 'commander';
import type { AlignShapes } from '../../../domain/commands/types.js';
import { usageError } from '../../../domain/document/utils/errors.js';
import type { RawOpts } from './CliCommand.js';
import { FormatCommand } from './FormatCommand.js';

/**
 * Diagram only: puts shapes on one row or one column (`bpmn align`).
 */
export class AlignCommand extends FormatCommand {
  register(program: CommandType): void {
    this.withMutationOptions(
      this.withSelectors(
        this.define(program, 'align')
          .addOption(new Option('--axis <axis>').makeOptionMandatory())
          .option('--to <id>'),
      ),
    ).action((file: string, ids: string[], options: RawOpts) =>
      this.cli.guarded(async () => {
        const sel = this.selectorsOf(ids, options, true);
        if (!sel.path && !sel.kind && !sel.branch && ids.length < 2 && !options['to']) throw usageError('align needs two ids, or one id and --to <id>');
        const op: AlignShapes = { op: 'align', ...sel, axis: options['axis'] as AlignShapes['axis'], ...this.pick(options, ['to'] as const) };
        await this.runFormat(file, op, options);
      }, !!options['json']),
    );
  }
}
