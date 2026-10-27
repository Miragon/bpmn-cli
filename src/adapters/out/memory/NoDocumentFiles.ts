import type { LoadDocumentPort } from '../../../application/port/out/LoadDocumentPort.js';
import type { SaveDocumentPort } from '../../../application/port/out/SaveDocumentPort.js';
import { ioError } from '../../../domain/document/utils/errors.js';

/** A document in memory has no file: there is none to read, and none is written or taken. */
export class NoDocumentFiles implements LoadDocumentPort, SaveDocumentPort {
  async read(file: string): Promise<string> {
    throw ioError('E_FILE_NOT_FOUND', `Cannot read ${file}: no such document`, { file });
  }

  decode(_bytes: Uint8Array, source: string): string {
    throw ioError('E_FILE_NOT_FOUND', `Cannot read ${source}: no such document`, { file: source });
  }

  async save(): Promise<boolean> {
    throw ioError('E_NO_FILE', 'No output file given');
  }

  async assertNew(): Promise<void> {}
}
