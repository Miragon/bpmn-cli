import { Doc } from '../model/document.js';
import type { Op } from '../ops/types.js';
import { assertLayoutOptions, assertLossless, type CheckResult, type MutationResult } from '../pipeline/index.js';
import { DocFile, type FileCheckOptions, type FileLayoutOptions, type FileMutationOptions } from './DocFile.js';
import { readXml } from './utils/files.js';

/**
 * A BPMN file on disk, read in the encoding its XML declaration names
 * (decodeXmlBytes: UTF-8 without one, UTF-16 by its byte order mark), so that
 * the characters of an ISO-8859-1 / Windows-1252 file survive; every write is
 * UTF-8, and a changed result declares UTF-8 (src/xml/utils/encoding.ts). Writes go
 * through DocFile.
 */
export class ModelFile {
  constructor(private readonly path: string) {}

  /** Reads and parses the file (no lossy-import guard: for reading commands). */
  async read(): Promise<Doc> {
    return Doc.fromXml(await readXml(this.path), this.path);
  }

  /** Loads the file and refuses to continue when bpmn-moddle dropped content (E_IMPORT_LOSSY unless force). */
  async load(opts: { force?: boolean } = {}): Promise<Doc> {
    const doc = await this.read();
    assertLossless(doc, opts);
    return doc;
  }

  async mutate(ops: Op[], opts: FileMutationOptions = {}): Promise<MutationResult> {
    return new DocFile(await this.load(opts)).mutate(ops, opts);
  }

  /** `bpmn layout`: redraws the file (or with `tidy` removes overlaps) and writes it back. */
  async layout(opts: FileLayoutOptions = {}): Promise<MutationResult> {
    assertLayoutOptions(opts);
    return new DocFile(await this.load(opts)).layout(opts);
  }

  async check(opts: FileCheckOptions = {}): Promise<CheckResult> {
    return new DocFile(await this.read()).check(opts);
  }
}
