import type { Command as CommandType } from 'commander';
import type { ReorderElements } from '../../../domain/commands/types.js';
import type { RawOpts } from './CliCommand.js';
import { MutationCommand } from './MutationCommand.js';

/**
 * Reorders the outgoing flows of a node, the lanes of a pool or lane,
 * or the pools of a collaboration (`bpmn order`).
 */
export class ReorderCommand extends MutationCommand {
  register(program: CommandType): void {
    this.withMutationOptions(this.define(program, 'order')).action((file: string, nodeId: string, flowIds: string[], options: RawOpts) => this.run(file, nodeId, flowIds, options));
  }

  private async run(file: string, nodeId: string, flowIds: string[], options: RawOpts): Promise<void> {
    const opts = this.mutationOptions(options);
    const command: ReorderElements = { op: 'order', id: nodeId, flows: flowIds };
    await this.mutate(file, [command], opts);
  }
}
