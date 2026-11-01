import { existsSync, readFileSync } from 'node:fs';
import type { CliProcess } from './CliShell.js';

export class Cli {
  private static readonly VERSION_WORDS: readonly string[] = ['--version', '-V'];

  constructor(private readonly process: CliProcess) {}

  private static version(): string {
    let manifest = new URL('../package.json', import.meta.url);
    while (!existsSync(manifest)) {
      manifest = new URL('../package.json', manifest);
    }
    return (JSON.parse(readFileSync(manifest, 'utf8')) as { version: string }).version;
  }

  async run(words: string[]): Promise<number> {
    const version = Cli.version();
    if (words.length === 1 && Cli.VERSION_WORDS.includes(words[0]!)) {
      this.process.stdout.write(`${version}\n`);
      return 0;
    }
    const { CliProgram } = await import('./CliProgram.js');
    return new CliProgram(this.process, version).run(words);
  }
}
