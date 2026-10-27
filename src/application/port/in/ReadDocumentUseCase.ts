import type { Doc } from '../../../domain/document/Doc.js';

/** Opens a document from its file, from bytes read elsewhere (stdin) or from its XML text. */
export interface ReadDocumentUseCase {

  read(command: ReadDocumentUseCase.Command): Promise<ReadDocumentUseCase.Result>;

  /** Throws E_IMPORT_LOSSY when bpmn-moddle dropped content on import, unless `force`. */
  assertLossless(command: ReadDocumentUseCase.LosslessCommand): void;
}

export declare namespace ReadDocumentUseCase {

  /** Where the document comes from and how strictly it is read. */
  interface Command {

    /** `xml` with the `file` it names (`doc.file`), if any */
    source: { file: string } | { bytes: Uint8Array; name: string } | { xml: string; file?: string };

    /**
     * E_IMPORT_LOSSY when bpmn-moddle dropped content, unless `force`
     * (default: no guard, for reading commands)
     */
    lossless?: boolean;

    force?: boolean;
  }

  /** The opened document. */
  type Result = Doc;

  /** The document to check for content dropped on import. */
  interface LosslessCommand {
    doc: Doc;
    /** accept a lossy import */
    force?: boolean;
  }
}
