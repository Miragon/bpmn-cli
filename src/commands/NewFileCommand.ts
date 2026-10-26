import { InvalidArgumentError, type Command as CommandType } from 'commander';
import { Doc } from '../model/Doc.js';
import { newProcessChange } from '../model/utils/new-process.js';
import { ConventionsLookup } from '../node/ConventionsLookup.js';
import { assertNewFile } from '../node/utils/files.js';
import { DocFile } from '../node/DocFile.js';
import type { RawOpts } from './CliCommand.js';
import { MutationCommand } from './MutationCommand.js';

/**
 * Creates a new .bpmn file with one empty process (`bpmn new`).
 */
export class NewFileCommand extends MutationCommand {
  register(program: CommandType): void {
    this.withMutationOptions(
      this.define(program, 'new')
        .option('--name <text>', 'process name')
        .option('--id <processId>', "process id (default: Process_<Name> or Process_1; a bpmn:Process prefix the .bpmnlintrc's element-id-naming names: that prefix and the name, process_main without one)")
        .option('--no-executable', 'isExecutable=false')
        .option('--target <platform>', 'camunda8 | camunda7: declare vendor namespaces (camunda7: also historyTimeToLive=180 and the platform version, like Camunda Modeler; for CIB seven and Operaton too)', (raw: string) => {
          try {
            Doc.assertTarget(raw);
          } catch {
            throw new InvalidArgumentError('expected camunda8 or camunda7 (camunda7 also covers CIB seven and Operaton)');
          }
          return raw;
        }),
    ).action((file: string, options: RawOpts) => this.run(file, options));
  }

  private async run(file: string, options: RawOpts): Promise<void> {
    const opts = this.mutationOptions(options);
    await this.cli.guarded(async () => {
      // `new -` (or -o -) writes the new model to stdout
      const stdout = file === '-' || opts.out === '-';
      // fail before the .bpmnlintrc is read: an invalid --id, a file that exists
      const processId = options['id'] as string | undefined;
      if (processId !== undefined) Doc.assertProcessId(processId);
      if (!stdout) await assertNewFile(opts.out ?? file, opts);
      // the id conventions of the .bpmnlintrc that applies to the file written
      const target = opts.out && opts.out !== '-' ? opts.out : file === '-' ? undefined : file;
      const conventions = (await ConventionsLookup.of(target, opts)).conventions;
      const doc = Doc.create(
        {
          processName: options['name'] as string | undefined,
          processId,
          executable: options['executable'] !== false,
          target: options['target'] as 'camunda8' | 'camunda7' | undefined,
          ...(conventions ? { conventions } : {}),
        },
        file === '-' ? undefined : file,
      );
      const result = await new DocFile(doc).mutate([], { ...opts, mustNotExist: true, ...(stdout ? { out: undefined, dryRun: true } : {}) });
      result.changes.create(newProcessChange(doc, options['name'] as string | undefined));
      await this.emit(result, opts, stdout);
    }, opts.json);
  }
}
