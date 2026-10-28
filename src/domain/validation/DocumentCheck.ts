import type { Doc } from '../document/Doc.js';
import type { BpmnError } from '../document/BpmnError.js';
import type { Finding } from '../document/Finding.js';
import type { LayoutStatus } from '../diagram/types.js';
import { LayoutDebug, type DebugSink } from '../diagram/layout/LayoutDebug.js';
import { FullLayout } from '../diagram/layout/FullLayout.js';
import { reportedImportWarnings } from '../editing/utils/decision-link-warnings.js';
import { PlatformDetection, type PlatformChoice } from '../document/vendor/PlatformDetection.js';
import { PLATFORM_PROFILES } from './profiles/PlatformProfiles.js';
import { StructuralValidator, type ValidationResult } from './StructuralValidator.js';
import { ValidatorSet } from './ValidatorSet.js';
import { counts, withValidatorReports } from './utils/validator-issues.js';
import { once } from './utils/once.js';
import type { Validator, ValidatorReport, ValidatorRun } from './validators.js';
import { toBpmnError } from '../document/utils/bpmn-error.js';

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
  layout: LayoutStatus | { status: 'failed'; error: Finding };
  importWarnings: string[];
}

/**
 * `bpmn validate` on one document: its structure, the validators, and a layout dry run. The
 * validators run before the dry run redraws the model, so they see the document's diagram; the
 * dry run redraws the in-memory document, so pass a document of its own.
 */
export class DocumentCheck {
  constructor(
    private readonly doc: Doc,
    private readonly opts: CheckOptions,
  ) {}

  run(): Promise<CheckResult> {
    return LayoutDebug.during(this.opts.debug, async () => {
      const platform = this.opts.platform ?? 'auto';
      await PLATFORM_PROFILES.ensure(this.doc, platform);
      let validation = new StructuralValidator(this.doc).validate({ platform });
      const structuralErrors = validation.errors.length;
      const importWarnings = reportedImportWarnings(this.doc).map((warning) => warning.message.split('\n')[0]!);
      const validators = new ValidatorSet(this.opts.validators);
      if (validators.size) {
        const runs = await this.runValidators(validators, platform);
        validation = withValidatorReports(validation, DocumentCheck.reports(runs), runs);
      }
      const layout = structuralErrors ? { status: 'skipped' as const, warnings: [], expanded: [] } : await this.layoutDryRun();
      return { validation, layout, importWarnings };
    });
  }

  private runValidators(validators: ValidatorSet, platform: PlatformChoice): Promise<ValidatorRun[]> {
    const doc = this.doc;
    const file = this.opts.file ?? doc.file;
    return validators.run({ xml: once(async () => doc.source?.text ?? (await doc.toXml())), doc: async () => doc }, { ...(file ? { file } : {}), phase: 'check', platform: PlatformDetection.of(doc).resolve(platform).platform, ops: [] });
  }

  private async layoutDryRun(): Promise<CheckResult['layout']> {
    try {
      const layoutResult = await new FullLayout(this.doc.model, {}).run();
      return { status: 'ok', warnings: layoutResult.warnings, expanded: layoutResult.expanded };
    } catch (err) {
      const bpmnError = toBpmnError(err) as BpmnError;
      return { status: 'failed', error: { code: bpmnError.code, message: bpmnError.message, element: bpmnError.details?.element as string | undefined } };
    }
  }

  private static reports(runs: ValidatorRun[]): ValidatorReport[] {
    return runs.map((run) => ({
      name: run.name,
      ...(run.detail ? { detail: run.detail } : {}),
      ...(run.blocks === false ? { blocks: false as const } : {}),
      errors: run.issues.filter((issue) => issue.severity === 'error'),
      warnings: run.issues.filter((issue) => issue.severity === 'warning'),
      preexisting: [],
      resolved: [],
      counts: counts(run.issues),
    }));
  }
}
