import { InvalidArgumentError, type Command as CommandType } from 'commander';
import { parseSpaceAmount } from '../../../domain/commands/utils/space-amount.js';
import type { InsertSpace } from '../../../domain/commands/types.js';
import type { RawOpts } from './CliCommand.js';
import { FormatCommand } from './FormatCommand.js';

/**
 * Diagram only: inserts space right of or below an element,
 * like the modeler's space tool (`bpmn space`).
 */
export class InsertSpaceCommand extends FormatCommand {
  register(program: CommandType): void {
    this.withMutationOptions(
      this.define(program, 'space')
        .option('--after <id>')
        .option('--below <id>')
        .option('--by <amount>', 'column (default for --after), row (default for --below), <n>col / <n>row (n of them) or pixels (<n>, <n>px); -column, -<n>col, -row or -<px> closes that much empty space instead', (raw: string) => {
          if (!parseSpaceAmount(raw)) throw new InvalidArgumentError('expected column, row, <n>col, <n>row (2col: two columns) or pixels (80, 80px); negative (-column, -2col, -80) to close space');
          return /^\s*-?\d+\s*$/.test(raw) ? Number(raw) : raw;
        }),
    ).action((file: string, options: RawOpts) =>
      this.cli.guarded(async () => {
        this.checkFlagGroups(options, [['after', 'below']], 'space needs --after <id> (horizontal space) or --below <id> (vertical space)');
        const op: InsertSpace = { op: 'space', ...this.pick(options, ['after', 'below'] as const), ...(options['by'] !== undefined ? { by: options['by'] as InsertSpace['by'] } : {}) };
        await this.runFormat(file, op, options);
      }, !!options['json']),
    );
  }
}
