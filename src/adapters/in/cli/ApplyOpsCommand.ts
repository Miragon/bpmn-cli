import { readFile } from 'node:fs/promises';
import type { Command as CommandType } from 'commander';
import { CommandParser } from '../../../domain/commands/CommandParser.js';
import type { EditCommand } from '../../../domain/commands/types.js';
import { ioError, usageError } from '../../../domain/document/utils/errors.js';
import { parseOpsJson } from '../../../domain/commands/utils/ops-json.js';
import type { RawOpts } from './CliCommand.js';
import { MutationCommand } from './MutationCommand.js';

/**
 * Applies a JSON list of operations in one transaction (`bpmn apply`).
 */
export class ApplyOpsCommand extends MutationCommand {
  register(program: CommandType): void {
    this.withMutationOptions(this.define(program, 'apply')).action((file: string, opsFile: string | undefined, options: RawOpts) => this.run(file, opsFile, options));
  }

  private async run(file: string, opsFile: string | undefined, options: RawOpts): Promise<void> {
    const opts = this.mutationOptions(options);
    const ops: EditCommand[] = new CommandParser().parse(parseOpsJson(await this.readOpsText(file, opsFile)));
    await this.mutate(file, ops, opts);
  }

  private async readOpsText(file: string, opsFile: string | undefined): Promise<string> {
    if (!opsFile || opsFile === '-') {
      if (file === '-') throw usageError('the model and the ops cannot both come from stdin', { hint: 'Pass the ops as a file: `bpmn apply - ops.json < model.bpmn` (or the model as a file: `bpmn apply model.bpmn - < ops.json`).' });
      return (await this.cli.readStdin('the ops')).toString('utf8');
    }
    try {
      return await readFile(opsFile, 'utf8');
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      throw ioError(error.code === 'ENOENT' ? 'E_FILE_NOT_FOUND' : 'E_IO', `Cannot read ops file ${opsFile}: ${error.message}`, {
        file: opsFile,
        hint: 'Pass the path of a JSON ops file, or `-` to read the ops from stdin.',
      });
    }
  }
}
