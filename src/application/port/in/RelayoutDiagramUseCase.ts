import type { FileBpmnlintOptions } from '../out/LoadProjectSettingsPort.js';
import type { DocumentSource } from './DocumentSource.js';
import type { FileWriteOptions } from './EditDocumentUseCase.js';
import type { MutationOptions, MutationResult } from '../../../domain/batch/types.js';
import type { LayoutOptions, LayoutResult } from '../../../domain/diagram/layout/FullLayout.js';
import type { DebugSink } from '../../../domain/diagram/layout/LayoutDebug.js';
import type { Model } from '../../../domain/document/utils/moddle.js';

/**
 * `bpmn layout`: the diagram redrawn, or with `tidy` only its overlaps removed,
 * the result written to the file.
 */
export interface RelayoutDiagramUseCase {

  relayout(command: RelayoutDiagramUseCase.Command): Promise<RelayoutDiagramUseCase.Result>;

  /**
   * Lays out the model. Its in-memory DI is replaced by the hint diagram as a side effect:
   * treat the returned XML as the truth and re-parse it if you need DI.
   */
  layoutModel(command: RelayoutDiagramUseCase.ModelCommand): Promise<LayoutResult>;

  /** Sets or, without a sink, clears the process-wide sink of layout diagnostics. */
  setDebugSink(command: RelayoutDiagramUseCase.DebugSinkCommand): void;
}

export declare namespace RelayoutDiagramUseCase {

  /** The document to lay out and how the result is written. */
  interface Command extends FileLayoutOptions {
    source: DocumentSource;
  }

  /** The relaid document and what was checked on it. */
  type Result = MutationResult;

  /** An in-memory model to lay out. */
  interface ModelCommand extends LayoutOptions {
    model: Model;
  }

  /** The sink of layout diagnostics; none clears it. */
  interface DebugSinkCommand {
    sink?: DebugSink;
  }
}

/** Options of `bpmn layout` (layoutDoc): a full redraw, or with `tidy` only overlaps removed. */
export interface LayoutDocOptions extends Omit<MutationOptions, 'layout'> {

  /** keep the drawing, only remove overlaps and gaps < 20 px; no expand / collapse */
  tidy?: boolean;
}

/** Everything `bpmn layout` takes when its result goes to a file. */
export interface FileLayoutOptions extends LayoutDocOptions, FileWriteOptions, FileBpmnlintOptions {}
