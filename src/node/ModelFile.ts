import { Doc } from '../model/Doc.js';
import type { Op } from '../ops/types.js';
import { type CheckResult, type MutationResult } from '../pipeline/index.js';
import { DocFile, type FileCheckOptions, type FileLayoutOptions, type FileMutationOptions } from './DocFile.js';
import { readXml } from './utils/files.js';
import { Relayout } from '../pipeline/Relayout.js';

/**
 * A BPMN file on disk, decoded in the encoding its XML declaration names so ISO-8859-1 and
 * Windows-1252 characters survive; every write is UTF-8.
 */
export class ModelFile {
  constructor(private readonly path: string) {}

  /** No lossy-import guard: for reading commands. */
  async read(): Promise<Doc> {
    return Doc.fromXml(await readXml(this.path), this.path);
  }

  async load(opts: { force?: boolean } = {}): Promise<Doc> {
    const doc = await this.read();
    (doc).assertLossless(opts);
    return doc;
  }

  async mutate(ops: Op[], opts: FileMutationOptions = {}): Promise<MutationResult> {
    return new DocFile(await this.load(opts)).mutate(ops, opts);
  }

  async layout(opts: FileLayoutOptions = {}): Promise<MutationResult> {
    new Relayout(opts).assertOptions();
    return new DocFile(await this.load(opts)).layout(opts);
  }

  async check(opts: FileCheckOptions = {}): Promise<CheckResult> {
    return new DocFile(await this.read()).check(opts);
  }
}
