import type { MutationOptions, MutationResult } from '../../../domain/batch/types.js';
import type { EditCommand } from '../../../domain/commands/types.js';
import type { PreservedText } from '../../../domain/document/xml/TextPreservation.js';
import type { FileBpmnlintOptions } from '../out/LoadProjectSettingsPort.js';
import type { DocumentSource } from './DocumentSource.js';

/**
 * `bpmn add`, `bpmn apply` and every other changing command:
 * the commands run on a document in one batch, the result written to its file.
 */
export interface EditDocumentUseCase {

  edit(command: EditDocumentUseCase.Command): Promise<EditDocumentUseCase.Result>;

  /** The changed model written with the original file's text wherever the model did not change. */
  preserveText(command: EditDocumentUseCase.PreserveTextCommand): Promise<PreservedText>;
}

export declare namespace EditDocumentUseCase {

  /** The commands to run on one document and how the result is written. */
  interface Command extends FileMutationOptions {
    source: DocumentSource;
    commands: EditCommand[];
  }

  /** What the batch changed, found and wrote. */
  type Result = MutationResult;

  /** The original file text, the model it was read as and the changed model. */
  interface PreserveTextCommand {
    original: string;
    baseline: string;
    next: string;
  }
}

/** Where a write goes: `out` instead of the input file, nothing on `dryRun`. */
export interface FileWriteOptions {

  /** write here instead of the input file */
  out?: string;

  /** write nothing, report what would be written */
  dryRun?: boolean;

  /** copy <file> to <file>.bak before writing */
  backup?: boolean;

  /** refuse to overwrite an existing file unless force */
  mustNotExist?: boolean;
}

/** Everything a changing command takes when its result goes to a file. */
export interface FileMutationOptions extends MutationOptions, FileWriteOptions, FileBpmnlintOptions {}
