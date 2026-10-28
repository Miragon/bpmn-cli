import { ioError } from '../../../domain/document/utils/errors.js';
import { DocumentStore } from '../document/DocumentStore.js';

/** A document in memory has no file: there is none to read, and none is written or taken. */
export class NoDocumentFiles extends DocumentStore {
  protected async read(file: string): Promise<string> {
    throw ioError('E_FILE_NOT_FOUND', `Cannot read ${file}: no such document`, { file });
  }

  protected decode(_bytes: Uint8Array, source: string): string {
    throw ioError('E_FILE_NOT_FOUND', `Cannot read ${source}: no such document`, { file: source });
  }

  protected async write(): Promise<boolean> {
    throw ioError('E_NO_FILE', 'No output file given');
  }

  protected async assertNew(): Promise<void> {}
}
