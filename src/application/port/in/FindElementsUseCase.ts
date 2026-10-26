import type { Doc } from '../../../domain/document/Doc.js';
import type { FindHit } from '../../../domain/views/model-view.js';

/**
 * `bpmn find`: elements whose id, name or vendor value contains a text (any case),
 * of one kind if given.
 */
export interface FindElementsUseCase {

  find(command: FindElementsUseCase.Command): FindElementsUseCase.Result;
}

export declare namespace FindElementsUseCase {

  interface Command {
    doc: Doc;
    text: string;
    kind?: string;
  }

  type Result = FindHit[];
}
