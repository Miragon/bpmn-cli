import type { Command as CommandType } from 'commander';
import type { MoveOp } from '../ops/types.js';
import { usageError } from '../shared/utils/errors.js';
import type { RawOpts } from './CliCommand.js';
import { MutationCommand } from './MutationCommand.js';

/**
 * Relocates nodes to another flow, scope, activity or lane (`bpmn move`).
 */
export class MoveCommand extends MutationCommand {
  register(program: CommandType): void {
    this.withMutationOptions(
      this.define(program, 'move')
        .option('--after <id>', 'insert after this node')
        .option('--before <id>', 'insert before this node')
        .option('--flow <flowId>', 'insert into this flow')
        .option('--in <scopeId>', 'move into this process / sub-process')
        .option('--on <activityId>', 'boundary events: re-attach to this activity')
        .option('--lane <laneId>', 'assign to this lane (empty string removes)'),
    ).action((file: string, ids: string[], o: RawOpts) => this.run(file, ids, o));
  }

  private async run(file: string, ids: string[], o: RawOpts): Promise<void> {
    const opts = this.mutationOptions(o);
    await this.cli.guarded(async () => {
      this.checkPlacementFlags(o);
      const op: MoveOp = {
        op: 'move',
        ids,
        ...(o['after'] ? { after: String(o['after']) } : {}),
        ...(o['before'] ? { before: String(o['before']) } : {}),
        ...(o['flow'] ? { flow: String(o['flow']) } : {}),
        ...(o['in'] ? { in: String(o['in']) } : {}),
        ...(o['on'] ? { on: String(o['on']) } : {}),
        ...(o['lane'] !== undefined ? { lane: String(o['lane']) } : {}),
      };
      if (!op.after && !op.before && !op.flow && !op.in && !op.on && op.lane === undefined) {
        throw usageError('move needs one of --after, --before, --flow, --in, --on or --lane');
      }
      await this.mutate(file, [op], opts);
    }, opts.json);
  }
}
