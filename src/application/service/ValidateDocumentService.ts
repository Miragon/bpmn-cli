import { PlatformDetection, type PlatformInfo } from '../../domain/document/vendor/PlatformDetection.js';
import { StructuralValidator, type ValidationResult } from '../../domain/validation/StructuralValidator.js';
import { DocumentCheck } from '../../domain/validation/DocumentCheck.js';
import type { ValidateDocumentUseCase } from '../port/in/ValidateDocumentUseCase.js';
import type { DocumentPort } from '../port/out/DocumentPort.js';
import type { EngineLintPort } from '../port/out/EngineLintPort.js';
import type { LoadProjectSettingsPort } from '../port/out/LoadProjectSettingsPort.js';

export class ValidateDocumentService implements ValidateDocumentUseCase {
  constructor(
    private readonly settings: LoadProjectSettingsPort,
    private readonly documents: DocumentPort,
    private readonly engine: EngineLintPort,
  ) {}

  async validate(command: ValidateDocumentUseCase.Command): Promise<ValidateDocumentUseCase.Result> {
    const { source, ...opts } = command;
    const doc = await this.documents.load(source);
    const project = (await this.settings.lint(opts.file ?? doc.file, opts)).applyTo({ engine: this.engine, ...opts }, doc.file);
    return new DocumentCheck(doc, project).run();
  }

  validateStructure(command: ValidateDocumentUseCase.DocumentCommand): ValidationResult {
    return new StructuralValidator(command.doc).validate();
  }

  detectPlatform(command: ValidateDocumentUseCase.DocumentCommand): PlatformInfo {
    return PlatformDetection.of(command.doc).info();
  }
}
