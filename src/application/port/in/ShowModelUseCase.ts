import type { Doc } from '../../../domain/document/Doc.js';
import type { ShownView, ViewOptions } from '../../../domain/views/ViewRequest.js';

/** `bpmn show`: the model as the agent sees it, or one element, its area or the drawing. */
export interface ShowModelUseCase {

  show(command: ShowModelUseCase.Command): ShowModelUseCase.Result;
}

export declare namespace ShowModelUseCase {

  interface Command extends ViewOptions {
    doc: Doc;
  }

  type Result = ShownView;
}
