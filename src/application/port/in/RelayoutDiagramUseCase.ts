import type { FileBpmnlintOptions } from '../out/LoadProjectSettingsPort.js';
import type { DocumentSource } from './DocumentSource.js';
import type { FileWriteOptions } from './EditDocumentUseCase.js';
import type { MutationOptions, MutationResult } from '../../../domain/batch/types.js';

/**
 * `bpmn layout`: the diagram redrawn, or with `tidy` only its overlaps removed,
 * the result written to the file.
 */
export interface RelayoutDiagramUseCase {

  relayout(command: RelayoutDiagramUseCase.Command): Promise<RelayoutDiagramUseCase.Result>;
}

export declare namespace RelayoutDiagramUseCase {

  interface Command extends FileLayoutOptions {
    source: DocumentSource;
  }

  type Result = MutationResult;
}

/** Options of `bpmn layout` (layoutDoc): a full redraw, or with `tidy` only overlaps removed. */
export interface LayoutDocOptions extends Omit<MutationOptions, 'layout'> {

  /** keep the drawing, only remove overlaps and gaps < 20 px; no expand / collapse */
  tidy?: boolean;
}

export interface FileLayoutOptions extends LayoutDocOptions, FileWriteOptions, FileBpmnlintOptions {}
