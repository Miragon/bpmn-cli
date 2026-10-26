import type { Command as CommandType } from 'commander';
import type { ConnectElements } from '../../../domain/commands/types.js';
import type { RawOpts } from './CliCommand.js';
import { MutationCommand } from './MutationCommand.js';

/**
 * Connects two elements; the kind of connection is inferred (`bpmn connect`).
 */
export class ConnectCommand extends MutationCommand {
  register(program: CommandType): void {
    this.withMutationOptions(
      this.define(program, 'connect')
        .option('--name <text>', 'flow name')
        .option('--id <id>', 'flow id')
        .option('--condition <expr>', 'condition expression (sequence flows)')
        .option('--language <lang>', 'expression language')
        .option('--default', 'default flow of the source gateway / activity')
        .option('--message <name>', 'message flows: message name')
        .option('--if-absent', 'succeed silently when the connection exists'),
    ).action((file: string, source: string, target: string, options: RawOpts) => this.run(file, source, target, options));
  }

  private async run(file: string, source: string, target: string, options: RawOpts): Promise<void> {
    const opts = this.mutationOptions(options);
    await this.cli.guarded(async () => {
      this.checkFlowFlags(options, false);
      const op: ConnectElements = {
        op: 'connect',
        source,
        target,
        ...(options['name'] ? { name: String(options['name']) } : {}),
        ...(options['id'] ? { id: String(options['id']) } : {}),
        ...(options['condition'] !== undefined ? { condition: String(options['condition']) } : {}),
        ...(options['language'] ? { language: String(options['language']) } : {}),
        ...(options['default'] ? { default: true } : {}),
        ...(options['message'] ? { message: String(options['message']) } : {}),
        ...(options['ifAbsent'] ? { ifAbsent: true } : {}),
      };
      await this.mutate(file, [op], opts);
    }, opts.json);
  }
}
