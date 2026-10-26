import type { Warning } from '../../../domain/document/CliError.js';
import type { DebugSink } from '../../../domain/diagram/layout/LayoutDebug.js';
import type { Doc } from '../../../domain/document/Doc.js';
import type { Platform, PlatformChoice, PlatformInfo } from '../../../domain/document/vendor/PlatformDetection.js';
import type { ValidateOptions, ValidationResult } from '../../../domain/validation/StructuralValidator.js';
import type { NamedValidator, Validator } from '../../../domain/validation/validators.js';
import type { ProfileReport } from '../../../domain/validation/profiles/PlatformProfiles.js';
import type { BpmnlintValidatorOptions } from '../../../domain/validation/BpmnlintValidator.js';
import type { BpmnlintConfig, BpmnlintEngine, ResolvedBpmnlintConfig } from '../../../domain/validation/bpmnlint-validator.js';
import type { FileBpmnlintOptions } from '../out/LoadProjectSettingsPort.js';
import type { DocumentSource } from './DocumentSource.js';
import type { LayoutStatus } from '../../../domain/diagram/types.js';

/**
 * `bpmn validate`: what is wrong with a document,
 * from its structure, the validators and a layout dry run; nothing is written.
 */
export interface ValidateDocumentUseCase {

  validate(command: ValidateDocumentUseCase.Command): Promise<ValidateDocumentUseCase.Result>;

  /** Structural validation and lint of a document, with the platform profile on request. */
  validateStructure(command: ValidateDocumentUseCase.StructureCommand): ValidationResult;

  /** Loads the engine rules of a platform (cached), needed before the synchronous profile runs. */
  loadProfile(command: ValidateDocumentUseCase.LoadProfileCommand): Promise<void>;

  /** Loads the engine rules of several platforms (default: all). */
  loadProfiles(command: ValidateDocumentUseCase.LoadProfilesCommand): Promise<void>;

  /** Runs the profile of the document's platform (or `choice`); its rules must be loaded. */
  runProfile(command: ValidateDocumentUseCase.ProfileCommand): ProfileReport;

  detectPlatform(command: ValidateDocumentUseCase.DocumentCommand): PlatformInfo;

  /** The advisory validator of a resolved bpmnlint configuration. */
  bpmnlintValidator(command: ValidateDocumentUseCase.BpmnlintValidatorCommand): NamedValidator;

  resolveBpmnlintConfig(command: ValidateDocumentUseCase.ResolveBpmnlintCommand): Promise<ResolvedBpmnlintConfig>;
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

  /** A document and the structural validation options. */
  interface StructureCommand extends DocumentCommand, ValidateOptions {}

  /** A document whose platform profile runs. */
  interface ProfileCommand extends DocumentCommand {
    /** the platform to run instead of the detected one */
    choice?: PlatformChoice;
  }

  /** The platform whose engine rules are loaded. */
  interface LoadProfileCommand {
    platform: Platform;
  }

  /** The platforms whose engine rules are loaded. */
  interface LoadProfilesCommand {
    /** default: all */
    platforms?: readonly Exclude<Platform, 'none'>[];
  }

  /** A bpmnlint engine and the resolved configuration it runs. */
  interface BpmnlintValidatorCommand extends BpmnlintValidatorOptions {
    engine: BpmnlintEngine;
    resolved: ResolvedBpmnlintConfig;
  }

  /** A bpmnlint configuration to resolve with an engine. */
  interface ResolveBpmnlintCommand {
    engine: BpmnlintEngine;
    config: BpmnlintConfig;
    moddleExtensions?: Record<string, object>;
  }
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

/** Everything `bpmn validate` takes for a file. */
export interface FileCheckOptions extends CheckOptions, FileBpmnlintOptions {}
