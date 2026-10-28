import type { Doc } from '../../../domain/document/Doc.js';
import type { FindHit } from '../../../domain/views/model-view.js';

/**
 * `bpmn find`: elements whose id, name or vendor value contains a text (any case),
 * of one kind if given.
 */
export interface FindElementsUseCase {

  find(command: FindElementsUseCase.Command): FindElementsUseCase.Result;

  /** An unknown or rejected kind fails with the same codes as `add` instead of matching nothing. */
  assertKind(command: FindElementsUseCase.KindCommand): void;
}

export declare namespace FindElementsUseCase {

  /** The document, the text to look for and an optional kind. */
  interface Command {
    doc: Doc;
    text: string;
    kind?: string;
  }

  /** The matching elements, in document order. */
  type Result = FindHit[];

  /** The kind a search is restricted to. */
  interface KindCommand {
    kind: string;
  }
}
