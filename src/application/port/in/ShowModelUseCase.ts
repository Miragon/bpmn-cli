import type { Doc } from '../../../domain/document/Doc.js';
import type { ExtensionInfo } from '../../../domain/document/ExtensionLister.js';
import type { El } from '../../../domain/document/utils/moddle.js';
import type { AroundOptions, AroundView, ElementContext, Implementation } from '../../../domain/views/around-view.js';
import type { LayoutView } from '../../../domain/views/layout-view.js';
import type { ElementDetail, ModelView } from '../../../domain/views/model-view.js';
import type { ShownView, ViewOptions } from '../../../domain/views/ViewRequest.js';

/** `bpmn show`: the model as the agent sees it, or one element, its area or the drawing. */
export interface ShowModelUseCase {

  show(command: ShowModelUseCase.Command): ShowModelUseCase.Result;

  modelView(command: ShowModelUseCase.DocumentCommand): ModelView;

  elementDetail(command: ShowModelUseCase.DetailCommand): ElementDetail;

  aroundView(command: ShowModelUseCase.AroundCommand): AroundView;

  elementContext(command: ShowModelUseCase.ElementIdCommand): ElementContext;

  layoutView(command: ShowModelUseCase.DefinitionsCommand): LayoutView;

  implementation(command: ShowModelUseCase.ElementCommand): Implementation | undefined;

  /** The extension elements of an element, in order. */
  extensions(command: ShowModelUseCase.ElementCommand): ExtensionInfo[];

  /** `ext list`: the element's own extension elements, then those of its nested elements. */
  allExtensions(command: ShowModelUseCase.ElementCommand): ExtensionInfo[];
}

export declare namespace ShowModelUseCase {

  /** The document and what of it to show. */
  interface Command extends ViewOptions {
    doc: Doc;
  }

  /** The view that was asked for. */
  type Result = ShownView;

  /** A document to view. */
  interface DocumentCommand {
    doc: Doc;
  }

  /** An element of the document to detail. */
  interface DetailCommand extends DocumentCommand {
    element: El;
  }

  /** An element of the document, by id. */
  interface ElementIdCommand extends DocumentCommand {
    id: string;
  }

  /** An element by id and how far its neighbourhood reaches. */
  interface AroundCommand extends ElementIdCommand, AroundOptions {}

  /** The parsed definitions whose drawing is shown. */
  interface DefinitionsCommand {
    definitions: El;
  }

  /** One element. */
  interface ElementCommand {
    element: El;
  }
}
