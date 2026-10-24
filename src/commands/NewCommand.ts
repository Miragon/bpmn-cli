import { InvalidArgumentError, type Command as CommandType } from 'commander';
import { Doc } from '../model/Doc.js';
import { newProcessChange } from '../model/utils/new-process.js';
import { ConventionsLookup } from '../node/ConventionsLookup.js';
import { assertNewFile } from '../node/utils/files.js';
import { DocFile } from '../node/DocFile.js';
import type { RawOpts } from './CliCommand.js';
import { MutationCommand } from './MutationCommand.js';

export class NewCommand extends MutationCommand {
  register(program: CommandType): void {
    this.withMutationOptions(
      this.define(program, 'new')
        .option('--name <text>', 'process name')
        .option('--id <processId>', "process id (default: Process_<Name> or Process_1; a bpmn:Process prefix the .bpmnlintrc's element-id-naming names: that prefix and the name, process_main without one)")
        .option('--no-executable', 'isExecutable=false')
        .option('--target <platform>', 'camunda8 | camunda7: declare vendor namespaces (camunda7: also historyTimeToLive=180 and the platform version, like Camunda Modeler; for CIB seven and Operaton too)', (v: string) => {
          try {
            Doc.assertTarget(v);
          } catch {
            throw new InvalidArgumentError('expected camunda8 or camunda7 (camunda7 also covers CIB seven and Operaton)');
          }
          return v;
        }),
    ).action((file: string, o: RawOpts) => this.run(file, o));
  }

  private async run(file: string, o: RawOpts): Promise<void> {
    const opts = this.mutationOptions(o);
    await this.cli.guarded(async () => {
      // `new -` (or -o -) writes the new model to stdout
      const stdout = file === '-' || opts.out === '-';
      // what fails without a .bpmnlintrc fails first, as before one was read: an invalid --id, a file that exists
      const processId = o['id'] as string | undefined;
      if (processId !== undefined) Doc.assertProcessId(processId);
      if (!stdout) await assertNewFile(opts.out ?? file, opts);
      // the id conventions of the .bpmnlintrc that applies to the file written (the process id only where they name bpmn:Process)
      const target = opts.out && opts.out !== '-' ? opts.out : file === '-' ? undefined : file;
      const conventions = (await ConventionsLookup.of(target, opts)).conventions;
      const doc = Doc.create(
        {
          processName: o['name'] as string | undefined,
          processId,
          executable: o['executable'] !== false,
          target: o['target'] as 'camunda8' | 'camunda7' | undefined,
          ...(conventions ? { conventions } : {}),
        },
        file === '-' ? undefined : file,
      );
      const result = await new DocFile(doc).mutate([], { ...opts, mustNotExist: true, ...(stdout ? { out: undefined, dryRun: true } : {}) });
      result.changes.create(newProcessChange(doc, o['name'] as string | undefined));
      await this.emit(result, opts, stdout);
    }, opts.json);
  }
}
