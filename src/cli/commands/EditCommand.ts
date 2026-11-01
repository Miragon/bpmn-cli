import { Option, type Command } from 'commander';
import { BpmnError } from '../../api/index.js';
import type { CliShell } from '../CliShell.js';
import { CommandSyntax } from './CommandSyntax.js';

export class EditCommand {
  private static readonly UNKNOWN_KIND = /^ops\[0\] \(\w+\): Unknown kind/;

  constructor(
    private readonly syntax: CommandSyntax,
    private readonly shell: CliShell,
  ) {}

  private static withKindCode(error: unknown): unknown {
    const isUnknownKind = error instanceof BpmnError && error.code === 'E_USAGE' && EditCommand.UNKNOWN_KIND.test(error.message);
    return isUnknownKind ? new BpmnError('E_UNKNOWN_KIND', error.message.replace(EditCommand.UNKNOWN_KIND, 'Unknown kind'), 'usage', error.details) : error;
  }

  register(program: Command): void {
    const { word, help } = this.syntax;
    const command = this.parentIn(program).command(word).description(help);
    for (const positional of this.syntax.positionals()) {
      command.argument(positional);
    }
    for (const { usage, help: flagHelp, choices } of [...this.syntax.flags(), ...CommandSyntax.SHARED_FLAGS]) {
      command.addOption(choices ? new Option(usage, flagHelp).choices(choices) : new Option(usage, flagHelp));
    }
    command.action((...words: unknown[]) => {
      const input = this.syntax.parse(words);
      return this.shell.write(input, [input.operation]).catch((error: unknown) => Promise.reject(EditCommand.withKindCode(error)));
    });
  }

  private parentIn(program: Command): Command {
    const { group } = this.syntax;
    if (group === undefined) {
      return program;
    }
    return program.commands.find((command) => command.name() === group) ?? program.command(group).description('vendor extension elements');
  }
}
