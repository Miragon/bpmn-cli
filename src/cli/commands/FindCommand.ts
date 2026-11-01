import type { Command } from 'commander';
import { type FindHit, findXml } from '../../api/index.js';
import type { CliShell } from '../CliShell.js';

interface FindFlags {
  kind?: string;
  in?: string;
  json?: boolean;
}

export class FindCommand {
  constructor(private readonly shell: CliShell) {}

  private static tabbed({ id, kind, name, in: within, match }: FindHit): string {
    return [id, kind, FindCommand.oneLine(name), within ?? '', FindCommand.oneLine(match)].join('\t').trimEnd();
  }

  private static oneLine(value = ''): string {
    return value.replace(/\s+/g, ' ').trim();
  }

  register(program: Command): void {
    program
      .command('find <file> [text]')
      .description('one line per element that matches a text, a kind or a container, id first (file - = stdin)')
      .option('--kind <kind>', 'one kind, as add writes it, or a family: task, event, gateway')
      .option('--in <id>', 'only inside this pool, process, lane or sub-process')
      .option('--json', 'print the hits as JSON')
      .action((path: string, text: string | undefined, flags: FindFlags) => this.run(path, text, flags));
  }

  private async run(path: string, text: string | undefined, { kind, in: within, json }: FindFlags): Promise<void> {
    const { shell } = this;
    const { text: aligned, ...data } = await findXml(await shell.file.read(path), { text, kind, in: within });
    if (json) {
      shell.printJson(data);
    } else if (data.hits.length) {
      shell.print(shell.stdout.isTTY ? aligned : data.hits.map(FindCommand.tabbed).join('\n'));
    }
  }
}
