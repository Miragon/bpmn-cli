import type { Command } from 'commander';
import { BpmnError, type Operation } from '../../api/index.js';
import type { CliShell } from '../CliShell.js';
import { CommandInput, type SharedFlags } from './CommandInput.js';
import { CommandSyntax } from './CommandSyntax.js';

export class ApplyCommand {
  constructor(private readonly shell: CliShell) {}

  private static parsed(text: string): Operation[] {
    try {
      return JSON.parse(text) as Operation[];
    } catch (error) {
      throw BpmnError.usage(`Ops are not valid JSON: ${(error as Error).message}`, { hint: 'Run `bpmn guide ops` for the format.' });
    }
  }

  register(program: Command): void {
    const command = program.command('apply <file> [operations]').description('apply a JSON list of operations in one transaction (a file, or - for stdin)');
    for (const { usage, help } of CommandSyntax.SHARED_FLAGS) {
      command.option(usage, help);
    }
    command.action(async (path: string, operationsPath: string | undefined, flags: SharedFlags) => {
      const text = await this.shell.file.readOperations(operationsPath, path);
      await this.shell.write(new CommandInput(path, { op: 'apply' }, flags), ApplyCommand.parsed(text));
    });
  }
}
