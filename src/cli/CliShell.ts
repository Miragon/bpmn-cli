import { resolve } from 'node:path';
import { applyToXml, BpmnError, type EditResult, type Operation } from '../api/index.js';
import type { CommandInput } from './commands/CommandInput.js';
import { BpmnFile, type StandardInput } from './files/BpmnFile.js';
import { IdConventionsReader } from './files/IdConventionsReader.js';
import { EditResultText } from './output/EditResultText.js';
import { ExitCode } from './output/ExitCode.js';

export type CliStream = Pick<NodeJS.WriteStream, 'write'> & Partial<Pick<NodeJS.WriteStream, 'on'>> & { readonly isTTY?: boolean };

export interface CliProcess extends StandardInput {
  readonly stdout: CliStream;
  readonly stderr: CliStream;
  readonly env: NodeJS.ProcessEnv;
  exit?(code: number): never;
}

export class CliShell {
  readonly exit = new ExitCode();
  readonly file: BpmnFile;
  readonly conventions = new IdConventionsReader();
  readonly stdout: CliStream;
  readonly stderr: CliStream;

  constructor(process: CliProcess) {
    this.file = new BpmnFile(process);
    this.stdout = process.stdout;
    this.stderr = process.stderr;
  }

  private static withFile(error: unknown, path: string): unknown {
    if (!(error instanceof BpmnError) || typeof error.details['command'] !== 'string' || path === BpmnFile.STANDARD_STREAM) {
      return error;
    }
    const quoted = /^[\w./@%+=:,-]+$/.test(path) ? path : `'${path.replace(/'/g, `'\\''`)}'`;
    error.details['command'] = error.details['command'].replaceAll('<file>', quoted);
    error.details.hint = error.details.hint?.replaceAll('bpmn space <file>', `bpmn space ${quoted}`);
    return error;
  }

  print(text: string, out: CliStream = this.stdout): void {
    out.write(text.endsWith('\n') ? text : `${text}\n`);
  }

  printJson(value: unknown, out: CliStream = this.stdout): void {
    out.write(`${JSON.stringify(value)}\n`);
  }

  async write(input: CommandInput, operations: Operation[]): Promise<void> {
    const { path, target, force, dryRun, json, toStandardOutput } = input;
    const { conventions } = await this.conventions.near(target);
    const source = await this.file.read(path);
    const { xml, ...result } = await applyToXml(source, operations, { force, conventions }).catch((error: unknown) => Promise.reject(CliShell.withFile(error, path)));
    const written = await this.written(input, xml, result);
    const out = toStandardOutput && !dryRun ? this.stderr : this.stdout;
    if (json) {
      this.printJson({ ok: true, file: target, written, ...result }, out);
    } else {
      this.print(new EditResultText(result, { file: target, written, dryRun }).text(), out);
    }
  }

  private async written({ target, path, dryRun, toStandardOutput }: CommandInput, xml: string, { unchanged }: Pick<EditResult, 'unchanged'>): Promise<boolean> {
    if (dryRun || (unchanged && !toStandardOutput && resolve(target) === resolve(path))) {
      return false;
    }
    if (toStandardOutput) {
      this.print(xml);
    } else {
      await this.file.write(target, xml);
    }
    return true;
  }
}
