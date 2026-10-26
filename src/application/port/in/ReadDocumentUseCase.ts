import type { Doc } from '../../../domain/document/Doc.js';

/** Opens a document from its file or from bytes read elsewhere (stdin). */
export interface ReadDocumentUseCase {

  read(command: ReadDocumentUseCase.Command): Promise<ReadDocumentUseCase.Result>;
}

export declare namespace ReadDocumentUseCase {

  interface Command {

    source: { file: string } | { bytes: Uint8Array; name: string };

    /**
     * E_IMPORT_LOSSY when bpmn-moddle dropped content, unless `force`
     * (default: no guard, for reading commands)
     */
    lossless?: boolean;

    force?: boolean;
  }

  type Result = Doc;
}
