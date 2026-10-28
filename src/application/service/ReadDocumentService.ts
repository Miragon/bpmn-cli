import type { ReadDocumentUseCase } from '../port/in/ReadDocumentUseCase.js';
import type { DocumentPort } from '../port/out/DocumentPort.js';

export class ReadDocumentService implements ReadDocumentUseCase {
  constructor(private readonly documents: DocumentPort) {}

  read(command: ReadDocumentUseCase.Command): Promise<ReadDocumentUseCase.Result> {
    return this.documents.load(command.source, command);
  }
}
