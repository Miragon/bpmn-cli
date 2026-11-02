import { Option, type Command } from 'commander';
import { BpmnError, type CommandWords } from '../../api/index.js';
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
    for (const { usage, help: flagHelp, choices, repeated } of [...this.syntax.flags(), ...CommandSyntax.SHARED_FLAGS]) {
      command.addOption(EditCommand.optionOf(usage, flagHelp, choices, repeated));
    }
    command.action((...words: unknown[]) => {
      const input = this.syntax.parse(words);
      return this.shell.write(input, [input.operation]).catch((error: unknown) => Promise.reject(this.forCommand(error)));
    });
  }

  private static optionOf(usage: string, help: string, choices: readonly string[] | undefined, repeated: boolean | undefined): Option {
    const option = new Option(usage, help);
    if (choices) {
      return option.choices(choices);
    }
    return repeated ? option.argParser((value: string, previous: string[] = []) => [...previous, value]) : option;
  }

  private forCommand(error: unknown): unknown {
    if (!(error instanceof BpmnError)) {
      return error;
    }
    const { op: _op, asCommand, ...details } = error.details;
    if (!asCommand) {
      return new BpmnError(error.code, error.message, error.category, details);
    }
    const { hint: _hint, ...others } = details;
    const hint = asCommand.hint ? { hint: this.spoken(asCommand.hint) } : {};
    return new BpmnError(asCommand.code ?? error.code, this.spoken(asCommand.message), error.category, { ...others, ...hint });
  }

  private spoken(words: CommandWords): string {
    return words.map((word) => (typeof word === 'string' ? word : this.syntax.wordFor(word.key))).join('');
  }

  private parentIn(program: Command): Command {
    const { group } = this.syntax;
    if (group === undefined) {
      return program;
    }
    return program.commands.find((command) => command.name() === group) ?? program.command(group).description('vendor extension elements');
  }
}
