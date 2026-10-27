import { Doc } from '../../domain/document/Doc.js';
import type { ReadDocumentUseCase } from '../port/in/ReadDocumentUseCase.js';
import type { LoadDocumentPort } from '../port/out/LoadDocumentPort.js';

/** Decoded in the encoding the XML declaration names, so ISO-8859-1 and Windows-1252 characters survive. */
export class ReadDocumentService implements ReadDocumentUseCase {
  constructor(private readonly load?: LoadDocumentPort) {}

  async read(command: ReadDocumentUseCase.Command): Promise<ReadDocumentUseCase.Result> {
    const doc = await this.parse(command.source);
    if (command.lossless) doc.assertLossless(command);
    return doc;
  }

  assertLossless(command: ReadDocumentUseCase.LosslessCommand): void {
    command.doc.assertLossless(command);
  }

  private async parse(source: ReadDocumentUseCase.Command['source']): Promise<Doc> {
    if ('xml' in source) return Doc.fromXml(source.xml, source.file);
    return 'file' in source ? Doc.fromXml(await this.load!.read(source.file), source.file) : Doc.fromXml(this.load!.decode(source.bytes, source.name));
  }
}
