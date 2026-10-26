import { Option, type Command as CommandType } from 'commander';
import type { AlignOp } from '../ops/types.js';
import { usageError } from '../shared/utils/errors.js';
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
          .addOption(new Option('--axis <axis>', 'row or column').choices(['row', 'column']).makeOptionMandatory())
          .option('--to <id>', 'reference element that stays (default: the first id; with only --kind and --axis column: the rightmost one)'),
        'align',
      ),
    ).action((file: string, ids: string[], options: RawOpts) =>
      this.cli.guarded(async () => {
        const sel = this.selectorsOf(ids, options, true);
        if (!sel.path && !sel.kind && !sel.branch && ids.length < 2 && !options['to']) throw usageError('align needs two ids, or one id and --to <id>');
        const op: AlignOp = { op: 'align', ...sel, axis: options['axis'] as AlignOp['axis'], ...this.pick(options, ['to'] as const) };
        await this.runFormat(file, op, options);
      }, !!options['json']),
    );
  }
}
