import { Option, type Command } from 'commander';
import type { CliShell } from '../CliShell.js';
import { CommandSyntax } from './CommandSyntax.js';

export class EditCommand {
  constructor(
    private readonly syntax: CommandSyntax,
    private readonly shell: CliShell,
  ) {}

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
      return this.shell.write(input, [input.operation]);
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
