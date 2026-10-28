import type { EditDocumentUseCase } from '../port/in/EditDocumentUseCase.js';
import type { DocumentPort } from '../port/out/DocumentPort.js';
import type { EngineLintPort } from '../port/out/EngineLintPort.js';
import type { LoadProjectSettingsPort } from '../port/out/LoadProjectSettingsPort.js';
import { EditBatch } from '../../domain/batch/EditBatch.js';
import { TextPreservation, type PreservedText } from '../../domain/document/xml/TextPreservation.js';

export class EditDocumentService implements EditDocumentUseCase {
  constructor(
    private readonly settings: LoadProjectSettingsPort,
    private readonly documents: DocumentPort,
    private readonly engine: EngineLintPort,
  ) {}

  async edit(command: EditDocumentUseCase.Command): Promise<EditDocumentUseCase.Result> {
    const { source, commands, ...opts } = command;
    const doc = await this.documents.load(source, { ...opts, lossless: true });
    const target = await this.documents.target(doc.file, opts);
    const project = (await this.settings.lint(opts.file ?? target, opts)).applyTo({ engine: this.engine, ...opts }, target);
    const result = await new EditBatch(doc, commands, project).run(target);
    await this.documents.save(result, doc, target, opts);
    return result;
  }

  preserveText(command: EditDocumentUseCase.PreserveTextCommand): Promise<PreservedText> {
    return new TextPreservation(command.original, command.baseline, command.next).result();
  }
}
