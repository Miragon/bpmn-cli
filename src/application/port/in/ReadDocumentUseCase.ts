import type { Doc } from '../../../domain/document/Doc.js';
import type { DocumentText } from './DocumentSource.js';

/** Opens a document from its file, from bytes read elsewhere (stdin) or from its XML text. */
export interface ReadDocumentUseCase {

  read(command: ReadDocumentUseCase.Command): Promise<ReadDocumentUseCase.Result>;
}

export declare namespace ReadDocumentUseCase {

  /** Where the document comes from and how strictly it is read. */
  interface Command {

    /** `xml` with the `file` it names (`doc.file`), if any */
    source: DocumentText;

    /**
     * E_IMPORT_LOSSY when bpmn-moddle dropped content, unless `force`
     * (default: no guard, for reading commands)
     */
    lossless?: boolean;

    force?: boolean;
  }

  /** The opened document. */
  type Result = Doc;
}
