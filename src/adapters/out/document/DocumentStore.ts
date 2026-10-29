import type { DocumentSource, DocumentText } from '../../../application/port/in/DocumentSource.js';
import type { FileWriteOptions } from '../../../application/port/in/EditDocumentUseCase.js';
import type { DocumentPort } from '../../../application/port/out/DocumentPort.js';
import type { MutationResult } from '../../../domain/batch/types.js';
import { Doc } from '../../../domain/document/Doc.js';
import { ioError } from '../../../domain/document/utils/errors.js';

export interface WriteOptions {
  source?: string;
  unchanged: boolean;
  backup?: boolean;
}

/** Loading, targeting and saving a document; where its bytes live is up to the store. */
export abstract class DocumentStore implements DocumentPort {
  async load(source: DocumentSource | DocumentText, opts: { lossless?: boolean; force?: boolean } = {}): Promise<Doc> {
    const doc = await this.parse(source);
    if (opts.lossless) doc.assertLossless(opts);
    return doc;
  }

  async text(source: DocumentText): Promise<string> {
    if ('xml' in source) return source.xml;
    return 'file' in source ? this.read(source.file) : this.decode(source.bytes, source.name);
  }

  async target(file: string | undefined, opts: FileWriteOptions & { force?: boolean }): Promise<string | undefined> {
    const target = opts.out ?? file;
    if (!opts.dryRun && !target) throw ioError('E_NO_FILE', 'No output file given');
    if (opts.mustNotExist) await this.assertNew(target, opts);
    return target;
  }

  async save(result: MutationResult, doc: Doc, target: string | undefined, opts: FileWriteOptions): Promise<void> {
    if (!opts.dryRun && target) {
      result.written = await this.write(target, result.xml, { source: doc.file, unchanged: result.unchanged, backup: opts.backup });
    }
  }

  protected abstract read(file: string): Promise<string>;

  protected abstract decode(bytes: Uint8Array, source: string): string;

  protected abstract assertNew(target: string | undefined, opts: { force?: boolean; dryRun?: boolean }): Promise<void>;

  protected abstract write(target: string, xml: string, opts: WriteOptions): Promise<boolean>;

  private async parse(source: DocumentSource | DocumentText): Promise<Doc> {
    if ('doc' in source) return source.doc;
    if ('xml' in source) return Doc.fromXml(source.xml, source.file);
    return 'file' in source ? Doc.fromXml(await this.read(source.file), source.file) : Doc.fromXml(this.decode(source.bytes, source.name));
  }
}
