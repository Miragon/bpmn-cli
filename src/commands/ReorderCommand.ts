import type { Command as CommandType } from 'commander';
import type { OrderOp } from '../ops/types.js';
import type { RawOpts } from './CliCommand.js';
import { MutationCommand } from './MutationCommand.js';

/**
 * Reorders the outgoing flows of a node, the lanes of a pool or lane,
 * or the pools of a collaboration (`bpmn order`).
 */
export class ReorderCommand extends MutationCommand {
  register(program: CommandType): void {
    this.withMutationOptions(this.define(program, 'order')).action((file: string, nodeId: string, flowIds: string[], o: RawOpts) => this.run(file, nodeId, flowIds, o));
  }

  private async run(file: string, nodeId: string, flowIds: string[], o: RawOpts): Promise<void> {
    const opts = this.mutationOptions(o);
    await this.cli.guarded(async () => {
      const op: OrderOp = { op: 'order', id: nodeId, flows: flowIds };
      await this.mutate(file, [op], opts);
    }, opts.json);
  }
}
