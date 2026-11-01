import type { Command } from 'commander';
import { showXml } from '../../api/index.js';
import type { CliShell } from '../CliShell.js';

interface ShowFlags {
  in?: string;
  around?: string;
  depth?: string;
  json?: boolean;
}

export class ShowCommand {
  constructor(private readonly shell: CliShell) {}

  register(program: Command): void {
    program
      .command('show <file> [id]')
      .description('the model, a part of it, or one element with everything needed to change it (file - = stdin)')
      .option('--in <id>', 'only this pool, process, lane or sub-process')
      .option('--around <id>', 'only the neighbourhood of this element')
      .option('--depth <n>', 'with --around: flow steps both ways')
      .option('--json', 'print the view as JSON')
      .action((path: string, id: string | undefined, flags: ShowFlags) => this.run(path, id, flags));
  }

  private async run(path: string, id: string | undefined, { in: within, around, depth, json }: ShowFlags): Promise<void> {
    const { text, ...data } = await showXml(await this.shell.file.read(path), { id, in: within, around, depth: depth === undefined ? undefined : Number(depth) });
    if (json) {
      this.shell.printJson(data);
    } else {
      this.shell.print(text);
    }
  }
}
