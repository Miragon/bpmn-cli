import type { MutationOptions, MutationResult } from '../../../domain/batch/types.js';
import type { EditCommand } from '../../../domain/commands/types.js';
import type { FileBpmnlintOptions } from '../out/LoadProjectSettingsPort.js';
import type { DocumentSource } from './DocumentSource.js';

/**
 * `bpmn add`, `bpmn apply` and every other changing command:
 * the commands run on a document in one batch, the result written to its file.
 */
export interface EditDocumentUseCase {

  edit(command: EditDocumentUseCase.Command): Promise<EditDocumentUseCase.Result>;
}

export declare namespace EditDocumentUseCase {

  interface Command extends FileMutationOptions {
    source: DocumentSource;
    commands: EditCommand[];
  }

  type Result = MutationResult;
}

/** Where a write goes: `out` instead of the input file, nothing on `dryRun`. */
export interface FileWriteOptions {

  /** write here instead of the input file */
  out?: string;

  dryRun?: boolean;

  /** copy <file> to <file>.bak before writing */
  backup?: boolean;

  /** refuse to overwrite an existing file unless force */
  mustNotExist?: boolean;
}

export interface FileMutationOptions extends MutationOptions, FileWriteOptions, FileBpmnlintOptions {}
