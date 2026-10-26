import type { NewDocOptions } from '../../../domain/document/Doc.js';
import type { FileMutationOptions } from './EditDocumentUseCase.js';
import type { MutationResult } from '../../../domain/batch/types.js';

/**
 * `bpmn new`: a document with one empty process,
 * its ids in the conventions of the project it goes to.
 */
export interface CreateDocumentUseCase {

  create(command: CreateDocumentUseCase.Command): Promise<CreateDocumentUseCase.Result>;
}

export declare namespace CreateDocumentUseCase {

  interface Command extends NewDocOptions, FileMutationOptions {

    /** where the document goes (undefined: nowhere yet); `out` overrides it */
    destination?: string;
  }

  type Result = MutationResult;
}
