import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { Writable } from 'node:stream';
import { Cli } from '../../src/cli/index.js';

export interface CliRun {
  exit: number;
  stdout: string;
  stderr: string;
}

export class InProcessCli {
  readonly folder = mkdtempSync(join(tmpdir(), 'bpmn-cli-e2e-'));

  private static collecting(chunks: string[]): Writable {
    return new Writable({
      write(chunk, _encoding, done) {
        chunks.push(String(chunk));
        done();
      },
    });
  }

  copied(corpusPath: string): string {
    const target = join(this.folder, basename(corpusPath));
    copyFileSync(join('corpus', corpusPath), target);
    return target;
  }

  async run(words: string[], { stdin = '', isTTY = false }: { stdin?: string; isTTY?: boolean } = {}): Promise<CliRun> {
    const [stdout, stderr]: string[][] = [[], []];
    const out = Object.assign(InProcessCli.collecting(stdout!), { isTTY });
    const exit = await new Cli({ stdout: out as never, stderr: InProcessCli.collecting(stderr!) as never, stdin: [stdin], env: {} }).run(words);
    return { exit, stdout: stdout!.join(''), stderr: stderr!.join('') };
  }

  remove(): void {
    rmSync(this.folder, { recursive: true, force: true });
  }
}
