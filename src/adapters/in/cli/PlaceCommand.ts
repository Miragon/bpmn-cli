import type { Command as CommandType } from 'commander';
import type { PlaceShapes } from '../../../domain/commands/types.js';
import { usageError } from '../../../domain/document/utils/errors.js';
import type { RawOpts } from './CliCommand.js';
import { FormatCommand } from './FormatCommand.js';
import { flag } from '../report/utils/option-flags.js';

/**
 * Diagram only: moves shapes to the row and/or column of another element (`bpmn place`).
 */
export class PlaceCommand extends FormatCommand {
  register(program: CommandType): void {
    this.withMutationOptions(
      this.withSelectors(
        this.define(program, 'place')
          .option('--row-of <id>')
          .option('--below <id>')
          .option('--above <id>')
          .option('--column-of <id>')
          .option('--after <id>')
          .option('--before <id>')
          .option('--side <side>')),
    ).action((file: string, ids: string[], options: RawOpts) =>
      this.cli.guarded(async () => {
        if (options['side'] !== undefined) {
          const given = ['rowOf', 'below', 'above', 'columnOf', 'after', 'before', 'path', 'kind', 'branch'].filter((flag) => options[flag] !== undefined);
          if (given.length) throw usageError(`--side cannot be combined with ${given.map(flag).join(', ')}`, { hint: '`bpmn place <file> <boundaryEventId> --side top` moves a boundary event to the top border of its host; place the host to move both.' });
          if (ids.length !== 1) throw usageError('--side takes exactly one id: the boundary event', { hint: 'Example: `bpmn place order.bpmn Event_PaymentOverdue --side top`.' });
          await this.runFormat(file, { op: 'place', ids, side: options['side'] as PlaceShapes['side'] }, options);
          return;
        }
        this.checkFlagGroups(options, [['rowOf', 'below', 'above'], ['columnOf', 'after', 'before']], 'place needs a row (--row-of, --below, --above) and/or a column (--column-of, --after, --before), or --side for a boundary event');
        const op: PlaceShapes = { op: 'place', ...this.selectorsOf(ids, options, true), ...this.pick(options, ['rowOf', 'below', 'above', 'columnOf', 'after', 'before'] as const) };
        await this.runFormat(file, op, options);
      }, !!options['json']),
    );
  }
}
