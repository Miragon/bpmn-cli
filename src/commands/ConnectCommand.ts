import type { Command as CommandType } from 'commander';
import type { ConnectOp } from '../ops/types.js';
import type { RawOpts } from './CliCommand.js';
import { MutationCommand } from './MutationCommand.js';

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
    ).action((file: string, source: string, target: string, o: RawOpts) => this.run(file, source, target, o));
  }

  private async run(file: string, source: string, target: string, o: RawOpts): Promise<void> {
    const opts = this.mutationOptions(o);
    await this.cli.guarded(async () => {
      this.checkFlowFlags(o, false);
      const op: ConnectOp = {
        op: 'connect',
        source,
        target,
        ...(o['name'] ? { name: String(o['name']) } : {}),
        ...(o['id'] ? { id: String(o['id']) } : {}),
        ...(o['condition'] !== undefined ? { condition: String(o['condition']) } : {}),
        ...(o['language'] ? { language: String(o['language']) } : {}),
        ...(o['default'] ? { default: true } : {}),
        ...(o['message'] ? { message: String(o['message']) } : {}),
        ...(o['ifAbsent'] ? { ifAbsent: true } : {}),
      };
      await this.mutate(file, [op], opts);
    }, opts.json);
  }
}
