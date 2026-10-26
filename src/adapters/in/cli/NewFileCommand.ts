import { InvalidArgumentError, type Command as CommandType } from 'commander';
import { Doc } from '../../../domain/document/Doc.js';
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
      const result = await this.cli.useCases.create.create({
        ...opts,
        ...(file === '-' ? {} : { destination: file }),
        processName: options['name'] as string | undefined,
        processId: options['id'] as string | undefined,
        executable: options['executable'] !== false,
        target: options['target'] as 'camunda8' | 'camunda7' | undefined,
        mustNotExist: true,
        ...(stdout ? { out: undefined, dryRun: true } : {}),
      });
      await this.emit(result, opts, stdout);
    }, opts.json);
  }
}
