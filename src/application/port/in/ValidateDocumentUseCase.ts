import type { Warning } from '../../../domain/document/CliError.js';
import type { DebugSink } from '../../../domain/diagram/layout/LayoutDebug.js';
import type { PlatformChoice } from '../../../domain/document/vendor/PlatformDetection.js';
import type { ValidationResult } from '../../../domain/validation/StructuralValidator.js';
import type { Validator } from '../../../domain/validation/validators.js';
import type { FileBpmnlintOptions } from '../out/LoadProjectSettingsPort.js';
import type { DocumentSource } from './DocumentSource.js';
import type { LayoutStatus } from '../../../domain/batch/types.js';

/**
 * `bpmn validate`: what is wrong with a document,
 * from its structure, the validators and a layout dry run; nothing is written.
 */
export interface ValidateDocumentUseCase {

  validate(command: ValidateDocumentUseCase.Command): Promise<ValidateDocumentUseCase.Result>;
}

export declare namespace ValidateDocumentUseCase {

  interface Command extends FileCheckOptions {
    source: DocumentSource;
  }

  type Result = CheckResult;
}

/** Options of `bpmn validate` (checkDoc, checkFile, validateXml). */
export interface CheckOptions {

  platform?: PlatformChoice;

  /** their errors fail the check, an advisory one's too */
  validators?: Validator[];

  /** the file being checked, for the validators (default doc.file) */
  file?: string;

  /** receives the layout engines' diagnostic lines during this call */
  debug?: DebugSink;
}

/** What `bpmn validate` finds in a document (checkDoc). */
export interface CheckResult {

  validation: ValidationResult;
  layout: LayoutStatus | { status: 'failed'; error: Warning };
  importWarnings: string[];
}

export interface FileCheckOptions extends CheckOptions, FileBpmnlintOptions {}
