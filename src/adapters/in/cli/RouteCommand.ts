import type { Command as CommandType } from 'commander';
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
        .option('--exit <side>')
        .option('--entry <side>'),
    ).action((file: string, flowId: string, options: RawOpts) => {
      const command: RerouteFlow = { op: 'route', id: flowId, ...(this.pick(options, ['exit', 'entry'] as const) as Pick<RerouteFlow, 'exit' | 'entry'>) };
      return this.runFormat(file, command, options);
    });
  }
}
