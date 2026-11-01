import { Option, type Command } from 'commander';
import { newXml, type NewOptions } from '../../api/index.js';
import type { CliShell } from '../CliShell.js';
import { BpmnFile } from '../files/BpmnFile.js';

interface NewFlags {
  id?: string;
  target?: NewOptions['target'];
  force?: boolean;
  json?: boolean;
}

export class NewCommand {
  constructor(private readonly shell: CliShell) {}

  register(program: Command): void {
    program
      .command('new <file> [name]')
      .description('create a new .bpmn file with one empty process (file - = stdout)')
      .option('--id <id>', 'the process id')
      .addOption(new Option('--target <platform>', 'namespaces and platform of the file').choices(['camunda8', 'camunda7', 'none']))
      .option('--force', 'overwrite an existing file')
      .option('--json', 'print the result as JSON')
      .action((path: string, name: string | undefined, flags: NewFlags) => this.run(path, name, flags));
  }

  private async run(path: string, name: string | undefined, { id, target, force, json }: NewFlags): Promise<void> {
    const { shell } = this;
    const toStandardOutput = path === BpmnFile.STANDARD_STREAM;
    if (!toStandardOutput && !force) {
      await shell.file.assertNew(path);
    }
    const { conventions } = await shell.conventions.near(path);
    const xml = await newXml({ name, id, target, conventions } as NewOptions);
    if (toStandardOutput) {
      shell.print(xml);
    } else {
      await shell.file.write(path, xml);
    }
    const out = toStandardOutput ? shell.stderr : shell.stdout;
    if (json) {
      shell.printJson({ ok: true, file: path, written: true }, out);
    } else {
      shell.print(`written: ${path}`, out);
    }
  }
}
