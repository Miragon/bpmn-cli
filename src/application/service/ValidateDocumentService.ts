import { Doc } from '../../domain/document/Doc.js';
import type { CliError } from '../../domain/document/CliError.js';
import { LayoutDebug } from '../../domain/diagram/layout/LayoutDebug.js';
import { FullLayout } from '../../domain/diagram/layout/FullLayout.js';
import { reportedImportWarnings } from '../../domain/editing/utils/decision-link-warnings.js';
import { PlatformDetection, type PlatformInfo } from '../../domain/document/vendor/PlatformDetection.js';
import { PLATFORM_PROFILES, type ProfileReport } from '../../domain/validation/profiles/PlatformProfiles.js';
import { StructuralValidator, type ValidationResult } from '../../domain/validation/StructuralValidator.js';
import { BpmnlintValidator } from '../../domain/validation/BpmnlintValidator.js';
import { BpmnlintConfigResolution } from '../../domain/validation/BpmnlintConfigResolution.js';
import type { NamedValidator } from '../../domain/validation/validators.js';
import type { ResolvedBpmnlintConfig } from '../../domain/validation/bpmnlint-validator.js';
import { ValidatorSet } from '../../domain/validation/ValidatorSet.js';
import { counts, withValidatorReports } from '../../domain/validation/utils/validator-issues.js';
import { once } from '../../domain/validation/utils/once.js';
import type { ValidatorReport, ValidatorRun } from '../../domain/validation/validators.js';
import { toCliError } from '../../domain/document/utils/cli-error.js';
import type { CheckOptions, CheckResult, ValidateDocumentUseCase } from '../port/in/ValidateDocumentUseCase.js';
import type { LoadDocumentPort } from '../port/out/LoadDocumentPort.js';
import type { LoadProjectSettingsPort } from '../port/out/LoadProjectSettingsPort.js';

/** The layout dry run redraws the in-memory document: pass a document of its own. */
export class ValidateDocumentService implements ValidateDocumentUseCase {
  constructor(
    private readonly settings: LoadProjectSettingsPort,
    private readonly load?: LoadDocumentPort,
  ) {}

  async validate(command: ValidateDocumentUseCase.Command): Promise<ValidateDocumentUseCase.Result> {
    const { source, ...opts } = command;
    const doc = 'doc' in source ? source.doc : await Doc.fromXml(await this.load!.read(source.file), source.file);
    return this.check(doc, (await this.settings.lint(opts.file ?? doc.file, opts)).applyTo(opts, doc.file));
  }

  validateStructure(command: ValidateDocumentUseCase.StructureCommand): ValidationResult {
    const { doc, ...opts } = command;
    return new StructuralValidator(doc).validate(opts);
  }

  loadProfile(command: ValidateDocumentUseCase.LoadProfileCommand): Promise<void> {
    return PLATFORM_PROFILES.load(command.platform);
  }

  loadProfiles(command: ValidateDocumentUseCase.LoadProfilesCommand): Promise<void> {
    return PLATFORM_PROFILES.loadAll(command.platforms);
  }

  runProfile(command: ValidateDocumentUseCase.ProfileCommand): ProfileReport {
    return PLATFORM_PROFILES.run(command.doc, command.choice);
  }

  detectPlatform(command: ValidateDocumentUseCase.DocumentCommand): PlatformInfo {
    return PlatformDetection.of(command.doc).info();
  }

  bpmnlintValidator(command: ValidateDocumentUseCase.BpmnlintValidatorCommand): NamedValidator {
    const { engine, resolved, ...opts } = command;
    return new BpmnlintValidator(engine, resolved, opts).named();
  }

  resolveBpmnlintConfig(command: ValidateDocumentUseCase.ResolveBpmnlintCommand): Promise<ResolvedBpmnlintConfig> {
    const { engine, config, ...opts } = command;
    return new BpmnlintConfigResolution(engine, config, opts).resolve();
  }

  /** Validators run before the layout dry run redraws the model, so they see the document's diagram. */
  private async check(doc: Doc, opts: CheckOptions): Promise<CheckResult> {
    return LayoutDebug.during(opts.debug, async () => {
      await PLATFORM_PROFILES.ensure(doc, opts.platform ?? 'auto');
      let validation = new StructuralValidator(doc).validate({ platform: opts.platform ?? 'auto' });
      const structuralErrors = validation.errors.length;
      const importWarnings = reportedImportWarnings(doc).map((warning) => warning.message.split('\n')[0]!);
      const file = opts.file ?? doc.file;
      const validators = new ValidatorSet(opts.validators);
      if (validators.size) {
        const runs = await validators.run({ xml: once(async () => doc.source?.text ?? (await doc.toXml())), doc: async () => doc }, { ...(file ? { file } : {}), phase: 'check', platform: PlatformDetection.of(doc).resolve(opts.platform ?? 'auto').platform, ops: [] });
        validation = withValidatorReports(validation, ValidateDocumentService.reports(runs), runs);
      }
      let layout: CheckResult['layout'];
      if (structuralErrors) {
        layout = { status: 'skipped', warnings: [], expanded: [] };
      } else {
        try {
          const layoutResult = await new FullLayout(doc.model, {}).run();
          layout = { status: 'ok', warnings: layoutResult.warnings, expanded: layoutResult.expanded };
        } catch (err) {
          const cliError = toCliError(err) as CliError;
          layout = { status: 'failed', error: { code: cliError.code, message: cliError.message, element: cliError.details?.element as string | undefined } };
        }
      }
      return { validation, layout, importWarnings };
    });
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
