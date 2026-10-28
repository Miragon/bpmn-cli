import { Doc } from '../../domain/document/Doc.js';
import { newProcessChange } from '../../domain/document/utils/new-process.js';
import type { CreateDocumentUseCase } from '../port/in/CreateDocumentUseCase.js';
import type { DocumentPort } from '../port/out/DocumentPort.js';
import type { LoadProjectSettingsPort } from '../port/out/LoadProjectSettingsPort.js';
import { EditBatch } from '../../domain/batch/EditBatch.js';

export class CreateDocumentService implements CreateDocumentUseCase {
  constructor(
    private readonly settings: LoadProjectSettingsPort,
    private readonly documents: DocumentPort,
  ) {}

  /** An existing file fails before the .bpmnlintrc is read. */
  async create(command: CreateDocumentUseCase.Command): Promise<CreateDocumentUseCase.Result> {
    const { destination, ...opts } = command;
    if (opts.processId !== undefined) Doc.assertProcessId(opts.processId);
    const target = await this.documents.target(destination, opts);
    const project = (await this.settings.lint(opts.file ?? target, opts)).applyTo(opts, target);
    const conventions = opts.conventions ?? (await this.settings.idConventions(target, opts))?.conventions;
    const doc = Doc.create({ processName: opts.processName, processId: opts.processId, executable: opts.executable, target: opts.target, ...(conventions ? { conventions } : {}) }, destination);
    const result = await new EditBatch(doc, [], project).run(target);
    result.changes.create(newProcessChange(doc, opts.processName));
    await this.documents.save(result, doc, target, opts);
    return result;
  }
}
