import type { Command } from 'commander';
import { diagramXml } from '../../api/index.js';
import type { CliShell } from '../CliShell.js';

export class DiagramCommand {
  constructor(private readonly shell: CliShell) {}

  register(program: Command): void {
    program
      .command('diagram <file>')
      .description('the drawing: the layout score, the counts per kind, every problem with its ids, then the rows and columns (file - = stdin)')
      .option('--json', 'print the drawing as JSON')
      .action((path: string, flags: { json?: boolean }) => this.run(path, flags));
  }

  private async run(path: string, { json }: { json?: boolean }): Promise<void> {
    const { text, ...data } = await diagramXml(await this.shell.file.read(path));
    if (json) {
      this.shell.printJson({ file: path, ...data });
    } else {
      this.shell.print(text);
    }
  }
}
