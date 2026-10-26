import { Option, type Command as CommandType } from 'commander';
import { SIDE_VALUES } from '../../../domain/commands/utils/op-fields.js';
import type { RerouteFlow } from '../../../domain/commands/types.js';
import type { RawOpts } from './CliCommand.js';
import { FormatCommand } from './FormatCommand.js';

/**
 * Diagram only: routes a sequence or message flow again (`bpmn route`).
 */
export class RouteCommand extends FormatCommand {
  register(program: CommandType): void {
    this.withMutationOptions(
      this.define(program, 'route')
        .addOption(new Option('--exit <side>', `side it leaves its source by: ${SIDE_VALUES.join(' | ')}`).choices([...SIDE_VALUES]))
        .addOption(new Option('--entry <side>', `side it enters its target by: ${SIDE_VALUES.join(' | ')}`).choices([...SIDE_VALUES])),
    ).action((file: string, flowId: string, options: RawOpts) => {
      const op: RerouteFlow = { op: 'route', id: flowId, ...(this.pick(options, ['exit', 'entry'] as const) as Pick<RerouteFlow, 'exit' | 'entry'>) };
      return this.runFormat(file, op, options);
    });
  }
}
