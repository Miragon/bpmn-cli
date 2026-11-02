import { Command, CommanderError } from 'commander';
import { BpmnError } from '../api/index.js';
import { CliShell, type CliProcess } from './CliShell.js';
import { ApplyCommand } from './commands/ApplyCommand.js';
import { CommandSyntax } from './commands/CommandSyntax.js';
import { ConventionsCommand } from './commands/ConventionsCommand.js';
import { DiagramCommand } from './commands/DiagramCommand.js';
import { EditCommand } from './commands/EditCommand.js';
import { FindCommand } from './commands/FindCommand.js';
import { GuideCommand } from './commands/GuideCommand.js';
import { NewCommand } from './commands/NewCommand.js';
import { RenderCommand } from './commands/RenderCommand.js';
import { ShowCommand } from './commands/ShowCommand.js';
import { ValidateCommand } from './commands/ValidateCommand.js';
import { ErrorText } from './output/ErrorText.js';
import { ExitCode } from './output/ExitCode.js';

export class CliProgram {
  private static readonly SHOWN_BY_COMMANDER: readonly string[] = ['commander.helpDisplayed', 'commander.help', 'commander.version'];
  private static readonly USAGE_HINT = 'Run `bpmn <command> --help` for the options, or `bpmn guide` for the core of the guide.';

  private readonly shell: CliShell;

  readonly commander: Command;

  constructor(
    private readonly process: CliProcess,
    version: string,
  ) {
    const { stdout, stderr } = process;
    this.shell = new CliShell(process);
    this.commander = new Command('bpmn')
      .description('Edit BPMN 2.0 models semantically; the diagram is laid out automatically (bpmn.io).')
      .version(version)
      .exitOverride()
      .configureOutput({ writeOut: (text) => stdout.write(text), writeErr: (text) => stderr.write(text), outputError: () => undefined });
    this.register();
  }

  private static usageErrorOf({ message }: CommanderError): BpmnError {
    return BpmnError.usage(message.replace(/^error:\s*/, '').replace(/\s*\n\s*/g, ' ').trim(), { hint: CliProgram.USAGE_HINT });
  }

  async run(words: string[]): Promise<number> {
    try {
      await this.commander.parseAsync(words, { from: 'user' });
    } catch (error) {
      this.report(error, words.includes('--json'));
    }
    return this.shell.exit.code;
  }

  private register(): void {
    const { shell, commander } = this;
    const reads = [new NewCommand(shell), new ShowCommand(shell), new FindCommand(shell), new DiagramCommand(shell), new ConventionsCommand(shell), new ValidateCommand(shell)];
    const writes = CommandSyntax.editCommands().map((syntax) => new EditCommand(syntax, shell));
    for (const command of [...reads, ...writes, new ApplyCommand(shell), new RenderCommand(shell), new GuideCommand(shell)]) {
      command.register(commander);
    }
  }

  private report(error: unknown, json: boolean): void {
    if (error instanceof CommanderError) {
      if (CliProgram.SHOWN_BY_COMMANDER.includes(error.code)) {
        this.shell.exit.set(error.exitCode);
      } else {
        this.reportError(CliProgram.usageErrorOf(error), json);
      }
      return;
    }
    if (error instanceof BpmnError) {
      this.reportError(error, json);
      return;
    }
    this.reportInternal(error as Error, json);
  }

  private reportError(error: BpmnError, json: boolean): void {
    const { shell } = this;
    if (json) {
      shell.printJson({ ok: false, error: error.toJSON() }, shell.stderr);
    } else {
      shell.print(new ErrorText(error).text(), shell.stderr);
    }
    shell.exit.set(error.exitCode);
  }

  private reportInternal({ message, stack }: Error, json: boolean): void {
    const { shell } = this;
    if (json) {
      shell.printJson({ ok: false, error: { code: 'E_INTERNAL', message } }, shell.stderr);
    } else {
      shell.print(`error E_INTERNAL: ${message}${this.process.env['BPMN_DEBUG'] ? `\n${stack ?? ''}` : ''}`, shell.stderr);
    }
    shell.exit.set(ExitCode.INTERNAL);
  }
}
