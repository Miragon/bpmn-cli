import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { BpmnError } from '../../api/index.js';

export interface StandardInput {
  readonly stdin: AsyncIterable<Buffer | string>;
}

export class BpmnFile {
  static readonly STANDARD_STREAM = '-';

  private static readonly DECLARED_ENCODING = /^﻿?<\?xml\s[^?>]*?\bencoding\s*=\s*(["'])([^"']*)\1/;
  private static readonly DECLARATION_BYTES = 512;
  private static readonly ASCII_END = 0x80;

  private stdinHolds: string | undefined;

  constructor(private readonly input: StandardInput) {}

  private static decoded(bytes: Buffer, source: string): string {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) {
      return new TextDecoder('utf-16le').decode(bytes);
    }
    if (bytes[0] === 0xfe && bytes[1] === 0xff) {
      return new TextDecoder('utf-16be').decode(bytes);
    }
    const head = bytes.subarray(0, BpmnFile.DECLARATION_BYTES).toString('utf8');
    const encoding = BpmnFile.DECLARED_ENCODING.exec(head)?.[2]?.trim();
    if (encoding === undefined || /^utf-?8$/i.test(encoding)) {
      return bytes.toString('utf8');
    }
    return BpmnFile.decodedAs(bytes, encoding, source);
  }

  private static decodedAs(bytes: Buffer, encoding: string, source: string): string {
    let decoder: TextDecoder;
    try {
      decoder = new TextDecoder(encoding);
    } catch {
      if (bytes.every((byte) => byte < BpmnFile.ASCII_END)) {
        return bytes.toString('utf8');
      }
      throw BpmnError.io('E_IO', `Cannot read ${source}: it declares the encoding ${encoding}, which bpmn cannot decode`, { file: source, hint: 'Convert the file to UTF-8 (and declare encoding="UTF-8"), e.g. with iconv.' });
    }
    return decoder.decode(bytes);
  }

  async read(path: string): Promise<string> {
    if (path === BpmnFile.STANDARD_STREAM) {
      return BpmnFile.decoded(await this.standardInput('the model'), 'stdin');
    }
    let bytes: Buffer;
    try {
      bytes = await readFile(path);
    } catch (error) {
      throw BpmnError.io((error as NodeJS.ErrnoException).code === 'ENOENT' ? 'E_FILE_NOT_FOUND' : 'E_IO', `Cannot read ${path}: ${(error as Error).message}`, { file: path });
    }
    return BpmnFile.decoded(bytes, path);
  }

  async readOperations(path: string | undefined, modelPath: string): Promise<string> {
    if (path !== undefined && path !== BpmnFile.STANDARD_STREAM) {
      return this.operationsFile(path);
    }
    if (modelPath === BpmnFile.STANDARD_STREAM) {
      throw BpmnError.usage('the model and the ops cannot both come from stdin', { hint: 'Pass the ops as a file: `bpmn apply - ops.json < model.bpmn` (or the model as a file: `bpmn apply model.bpmn - < ops.json`).' });
    }
    return (await this.standardInput('the ops')).toString('utf8');
  }

  async write(path: string, content: string | Uint8Array): Promise<void> {
    const staged = join(dirname(path), `.${basename(path)}.${process.pid}.tmp`);
    try {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(staged, content);
      await rename(staged, path);
    } catch (error) {
      await rm(staged, { force: true });
      const reason = (error as NodeJS.ErrnoException).code === 'EISDIR' ? 'it is a directory' : (error as Error).message;
      throw BpmnError.io('E_IO', `Cannot write ${path}: ${reason}`, { file: path, hint: 'Name a file (not a directory) in a directory you can write to.' });
    }
  }

  async assertNew(path: string): Promise<void> {
    const existing = await stat(path).catch(() => undefined);
    if (existing) {
      throw BpmnError.io('E_FILE_EXISTS', `${path} already exists`, { file: path, hint: 'Choose another name or pass --force to overwrite.' });
    }
  }

  private async operationsFile(path: string): Promise<string> {
    try {
      return await readFile(path, 'utf8');
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'E_FILE_NOT_FOUND' : 'E_IO';
      throw BpmnError.io(code, `Cannot read ops file ${path}: ${(error as Error).message}`, { file: path, hint: 'Pass the path of a JSON ops file, or `-` to read the ops from stdin.' });
    }
  }

  private async standardInput(what: string): Promise<Buffer> {
    if (this.stdinHolds) {
      throw BpmnError.usage(`stdin already holds ${this.stdinHolds}; it cannot also hold ${what}`, { hint: 'Read one of them from a file, e.g. `bpmn apply - ops.json < model.bpmn`.' });
    }
    this.stdinHolds = what;
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of this.input.stdin) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      }
      return Buffer.concat(chunks);
    } catch (error) {
      throw BpmnError.io('E_IO', `Cannot read ${what} from stdin: ${(error as Error).message}`, { hint: 'Pipe the input in, e.g. `cat model.bpmn | bpmn show -`.' });
    }
  }
}
