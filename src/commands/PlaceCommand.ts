import { Option, type Command as CommandType } from 'commander';
import { BOUNDARY_SIDE_VALUES } from '../ops/batch.js';
import type { PlaceOp } from '../ops/types.js';
import { usageError } from '../shared/utils/errors.js';
import type { RawOpts } from './CliCommand.js';
import { FormatCommand } from './FormatCommand.js';
import { flag } from './utils/flags.js';

export class PlaceCommand extends FormatCommand {
  register(program: CommandType): void {
    this.withMutationOptions(
      this.withSelectors(
        this.define(program, 'place')
          .option('--row-of <id>', 'row: centre on the row of this element')
          .option('--below <id>', 'row: the row below this element')
          .option('--above <id>', 'row: the row above this element')
          .option('--column-of <id>', 'column: centre on the column of this element')
          .option('--after <id>', 'column: right of this element')
          .option('--before <id>', 'column: left of this element')
          .addOption(new Option('--side <side>', 'a boundary event (the only id): move it to this border of its host; its outgoing flow is routed again and its exception path follows').choices([...BOUNDARY_SIDE_VALUES])),
        'move',
      ),
    ).action((file: string, ids: string[], o: RawOpts) =>
      this.cli.guarded(async () => {
        if (o['side'] !== undefined) {
          const given = ['rowOf', 'below', 'above', 'columnOf', 'after', 'before', 'path', 'kind', 'branch'].filter((k) => o[k] !== undefined);
          if (given.length) throw usageError(`--side cannot be combined with ${given.map(flag).join(', ')}`, { hint: '`bpmn place <file> <boundaryEventId> --side top` moves a boundary event to the top border of its host; place the host to move both.' });
          if (ids.length !== 1) throw usageError('--side takes exactly one id: the boundary event', { hint: 'Example: `bpmn place order.bpmn Event_PaymentOverdue --side top`.' });
          await this.runFormat(file, { op: 'place', ids, side: o['side'] as PlaceOp['side'] }, o);
          return;
        }
        this.checkFlagGroups(o, [['rowOf', 'below', 'above'], ['columnOf', 'after', 'before']], 'place needs a row (--row-of, --below, --above) and/or a column (--column-of, --after, --before), or --side for a boundary event');
        const op: PlaceOp = { op: 'place', ...this.selectorsOf(ids, o, true), ...this.pick(o, ['rowOf', 'below', 'above', 'columnOf', 'after', 'before'] as const) };
        await this.runFormat(file, op, o);
      }, !!o['json']),
    );
  }
}
