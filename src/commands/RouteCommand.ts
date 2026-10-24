import { Option, type Command as CommandType } from 'commander';
import { SIDE_VALUES } from '../ops/utils/op-fields.js';
import type { RouteOp } from '../ops/types.js';
import type { RawOpts } from './CliCommand.js';
import { FormatCommand } from './FormatCommand.js';

export class RouteCommand extends FormatCommand {
  register(program: CommandType): void {
    this.withMutationOptions(
      this.define(program, 'route')
        .addOption(new Option('--exit <side>', `side it leaves its source by: ${SIDE_VALUES.join(' | ')}`).choices([...SIDE_VALUES]))
        .addOption(new Option('--entry <side>', `side it enters its target by: ${SIDE_VALUES.join(' | ')}`).choices([...SIDE_VALUES])),
    ).action((file: string, flowId: string, o: RawOpts) => {
      const op: RouteOp = { op: 'route', id: flowId, ...(this.pick(o, ['exit', 'entry'] as const) as Pick<RouteOp, 'exit' | 'entry'>) };
      return this.runFormat(file, op, o);
    });
  }
}
