import { existsSync, readFileSync } from 'node:fs';
import type { CliProcess } from './CliShell.js';

export class Cli {
  private static readonly VERSION_WORDS: readonly string[] = ['--version', '-V'];

  constructor(private readonly process: CliProcess) {}

  private static ignoreClosedReader(error: NodeJS.ErrnoException): void {
    if (error.code !== 'EPIPE') {
      throw error;
    }
  }

  private static version(): string {
    let manifest = new URL('../package.json', import.meta.url);
    while (!existsSync(manifest)) {
      manifest = new URL('../package.json', manifest);
    }
    return (JSON.parse(readFileSync(manifest, 'utf8')) as { version: string }).version;
  }

  async run(words: string[]): Promise<number> {
    const { stdout, stderr } = this.process;
    for (const stream of [stdout, stderr]) {
      stream.on?.('error', Cli.ignoreClosedReader);
    }
    const code = await this.answer(words);
    stdout.write('', () => stderr.write('', () => this.process.exit?.(code)));
    return code;
  }

  private async answer(words: string[]): Promise<number> {
    const version = Cli.version();
    if (words.length === 1 && Cli.VERSION_WORDS.includes(words[0]!)) {
      this.process.stdout.write(`${version}\n`);
      return 0;
    }
    const { CliProgram } = await import('./CliProgram.js');
    return new CliProgram(this.process, version).run(words);
  }
}
