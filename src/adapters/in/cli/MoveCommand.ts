import type { Command as CommandType } from 'commander';
import type { MoveElements } from '../../../domain/commands/types.js';
import { usageError } from '../../../domain/document/utils/errors.js';
import type { RawOpts } from './CliCommand.js';
import { MutationCommand } from './MutationCommand.js';
import { givenStrings } from './utils/flags.js';

/**
 * Relocates nodes to another flow, scope, activity or lane (`bpmn move`).
 */
export class MoveCommand extends MutationCommand {
  register(program: CommandType): void {
    this.withMutationOptions(
      this.define(program, 'move')
        .option('--after <id>')
        .option('--before <id>')
        .option('--flow <flowId>')
        .option('--in <scopeId>')
        .option('--on <activityId>')
        .option('--lane <laneId>'),
    ).action((file: string, ids: string[], options: RawOpts) => this.run(file, ids, options));
  }

  private async run(file: string, ids: string[], options: RawOpts): Promise<void> {
    const opts = this.mutationOptions(options);
    this.checkPlacementFlags(options);
    const command: MoveElements = {
      op: 'move',
      ids,
      ...givenStrings(options, ['after', 'before', 'flow', 'in', 'on']),
      ...(options['lane'] !== undefined ? { lane: String(options['lane']) } : {}),
    };
    if (!command.after && !command.before && !command.flow && !command.in && !command.on && command.lane === undefined) {
      throw usageError('move needs one of --after, --before, --flow, --in, --on or --lane');
    }
    await this.mutate(file, [command], opts);
  }
}
