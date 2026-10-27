import type { Command as CommandType } from 'commander';
import type { MoveElements } from '../../../domain/commands/types.js';
import { usageError } from '../../../domain/document/utils/errors.js';
import type { RawOpts } from './CliCommand.js';
import { MutationCommand } from './MutationCommand.js';

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
    await this.cli.guarded(async () => {
      this.checkPlacementFlags(options);
      const op: MoveElements = {
        op: 'move',
        ids,
        ...(options['after'] ? { after: String(options['after']) } : {}),
        ...(options['before'] ? { before: String(options['before']) } : {}),
        ...(options['flow'] ? { flow: String(options['flow']) } : {}),
        ...(options['in'] ? { in: String(options['in']) } : {}),
        ...(options['on'] ? { on: String(options['on']) } : {}),
        ...(options['lane'] !== undefined ? { lane: String(options['lane']) } : {}),
      };
      if (!op.after && !op.before && !op.flow && !op.in && !op.on && op.lane === undefined) {
        throw usageError('move needs one of --after, --before, --flow, --in, --on or --lane');
      }
      await this.mutate(file, [op], opts);
    }, opts.json);
  }
}
