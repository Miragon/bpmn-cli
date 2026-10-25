import { readFile } from 'node:fs/promises';
import type { Command as CommandType } from 'commander';
import { OpsParser } from '../ops/OpsParser.js';
import type { Op } from '../ops/types.js';
import { ioError, usageError } from '../shared/utils/errors.js';
import { parseOpsJson } from '../shared/utils/ops-json.js';
import type { RawOpts } from './CliCommand.js';
import { MutationCommand } from './MutationCommand.js';

/**
 * Applies a JSON list of operations in one transaction (`bpmn apply`).
 */
export class ApplyOpsCommand extends MutationCommand {
  register(program: CommandType): void {
    this.withMutationOptions(this.define(program, 'apply')).action((file: string, opsFile: string | undefined, o: RawOpts) => this.run(file, opsFile, o));
  }

  private async run(file: string, opsFile: string | undefined, o: RawOpts): Promise<void> {
    const opts = this.mutationOptions(o);
    await this.cli.guarded(async () => {
      const ops: Op[] = new OpsParser().parse(parseOpsJson(await this.readOpsText(file, opsFile)));
      await this.mutate(file, ops, opts);
    }, opts.json);
  }

  private async readOpsText(file: string, opsFile: string | undefined): Promise<string> {
    if (!opsFile || opsFile === '-') {
      if (file === '-') throw usageError('the model and the ops cannot both come from stdin', { hint: 'Pass the ops as a file: `bpmn apply - ops.json < model.bpmn` (or the model as a file: `bpmn apply model.bpmn - < ops.json`).' });
      return (await this.cli.readStdin('the ops')).toString('utf8');
    }
    try {
      return await readFile(opsFile, 'utf8');
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      throw ioError(e.code === 'ENOENT' ? 'E_FILE_NOT_FOUND' : 'E_IO', `Cannot read ops file ${opsFile}: ${e.message}`, {
        file: opsFile,
        hint: 'Pass the path of a JSON ops file, or `-` to read the ops from stdin.',
      });
    }
  }
}
