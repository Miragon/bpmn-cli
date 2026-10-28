import type { Command as CommandType } from 'commander';
import type { ConnectElements } from '../../../domain/commands/types.js';
import type { RawOpts } from './CliCommand.js';
import { MutationCommand } from './MutationCommand.js';
import { givenFlags, givenStrings } from './utils/flags.js';

/**
 * Connects two elements; the kind of connection is inferred (`bpmn connect`).
 */
export class ConnectCommand extends MutationCommand {
  register(program: CommandType): void {
    this.withMutationOptions(
      this.define(program, 'connect')
        .option('--name <text>')
        .option('--id <id>')
        .option('--condition <expr>')
        .option('--language <lang>')
        .option('--default')
        .option('--message <name>')
        .option('--if-absent'),
    ).action((file: string, source: string, target: string, options: RawOpts) => this.run(file, source, target, options));
  }

  private async run(file: string, source: string, target: string, options: RawOpts): Promise<void> {
    const opts = this.mutationOptions(options);
    this.checkFlowFlags(options, false);
    const command: ConnectElements = {
      op: 'connect',
      source,
      target,
      ...givenStrings(options, ['name', 'id', 'language', 'message']),
      ...givenFlags(options, ['default', 'ifAbsent']),
      ...(options['condition'] !== undefined ? { condition: String(options['condition']) } : {}),
    };
    await this.mutate(file, [command], opts);
  }
}
