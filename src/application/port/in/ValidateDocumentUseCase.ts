import type { Doc } from '../../../domain/document/Doc.js';
import type { PlatformInfo } from '../../../domain/document/vendor/PlatformDetection.js';
import type { ValidationResult } from '../../../domain/validation/StructuralValidator.js';
import type { FileBpmnlintOptions } from '../out/LoadProjectSettingsPort.js';
import type { CheckOptions, CheckResult } from '../../../domain/validation/DocumentCheck.js';
import type { DocumentSource } from './DocumentSource.js';

/**
 * `bpmn validate`: what is wrong with a document,
 * from its structure, the validators and a layout dry run; nothing is written.
 */
export interface ValidateDocumentUseCase {

  validate(command: ValidateDocumentUseCase.Command): Promise<ValidateDocumentUseCase.Result>;

  /** Structural validation and lint of a document (the engine rules run in `validate`). */
  validateStructure(command: ValidateDocumentUseCase.DocumentCommand): ValidationResult;

  detectPlatform(command: ValidateDocumentUseCase.DocumentCommand): PlatformInfo;
}

export declare namespace ValidateDocumentUseCase {

  /** The document to check and how. */
  interface Command extends FileCheckOptions {
    source: DocumentSource;
  }

  /** What the check found. */
  type Result = CheckResult;

  /** A document to check. */
  interface DocumentCommand {
    doc: Doc;
  }

}

export type { CheckOptions, CheckResult };

/** Everything `bpmn validate` takes for a file. */
export interface FileCheckOptions extends CheckOptions, FileBpmnlintOptions {}
