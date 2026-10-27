import { Doc } from '../../domain/document/Doc.js';
import { PlatformDetection, type PlatformInfo } from '../../domain/document/vendor/PlatformDetection.js';
import { PLATFORM_PROFILES, type ProfileReport } from '../../domain/validation/profiles/PlatformProfiles.js';
import { StructuralValidator, type ValidationResult } from '../../domain/validation/StructuralValidator.js';
import { BpmnlintValidator } from '../../domain/validation/BpmnlintValidator.js';
import { BpmnlintConfigResolution } from '../../domain/validation/BpmnlintConfigResolution.js';
import { DocumentCheck } from '../../domain/validation/DocumentCheck.js';
import type { NamedValidator } from '../../domain/validation/validators.js';
import type { ResolvedBpmnlintConfig } from '../../domain/validation/bpmnlint-validator.js';
import type { DocumentSource } from '../port/in/DocumentSource.js';
import type { ValidateDocumentUseCase } from '../port/in/ValidateDocumentUseCase.js';
import type { LoadDocumentPort } from '../port/out/LoadDocumentPort.js';
import type { LoadProjectSettingsPort } from '../port/out/LoadProjectSettingsPort.js';

export class ValidateDocumentService implements ValidateDocumentUseCase {
  constructor(
    private readonly settings: LoadProjectSettingsPort,
    private readonly load: LoadDocumentPort,
  ) {}

  async validate(command: ValidateDocumentUseCase.Command): Promise<ValidateDocumentUseCase.Result> {
    const { source, ...opts } = command;
    const doc = await this.open(source);
    const project = (await this.settings.lint(opts.file ?? doc.file, opts)).applyTo(opts, doc.file);
    return new DocumentCheck(doc, project).run();
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

  private async open(source: DocumentSource): Promise<Doc> {
    return 'doc' in source ? source.doc : Doc.fromXml(await this.load.read(source.file), source.file);
  }
}
