import { Doc } from '../../domain/document/Doc.js';
import type { ReadDocumentUseCase } from '../port/in/ReadDocumentUseCase.js';
import type { LoadDocumentPort } from '../port/out/LoadDocumentPort.js';

/** Decoded in the encoding the XML declaration names, so ISO-8859-1 and Windows-1252 characters survive. */
export class ReadDocumentService implements ReadDocumentUseCase {
  constructor(private readonly load: LoadDocumentPort) {}

  async read(command: ReadDocumentUseCase.Command): Promise<ReadDocumentUseCase.Result> {
    const source = command.source;
    const doc = 'file' in source ? await Doc.fromXml(await this.load.read(source.file), source.file) : await Doc.fromXml(this.load.decode(source.bytes, source.name));
    if (command.lossless) doc.assertLossless(command);
    return doc;
  }
}
