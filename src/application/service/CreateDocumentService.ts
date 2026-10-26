import { Doc } from '../../domain/document/Doc.js';
import { ioError } from '../../domain/document/utils/errors.js';
import { newProcessChange } from '../../domain/document/utils/new-process.js';
import type { CreateDocumentUseCase } from '../port/in/CreateDocumentUseCase.js';
import type { LoadProjectSettingsPort } from '../port/out/LoadProjectSettingsPort.js';
import type { SaveDocumentPort } from '../port/out/SaveDocumentPort.js';
import { EditBatchService } from '../../domain/batch/EditBatchService.js';

export class CreateDocumentService implements CreateDocumentUseCase {
  constructor(
    private readonly save: SaveDocumentPort,
    private readonly settings: LoadProjectSettingsPort,
  ) {}

  /** An existing file fails before the .bpmnlintrc is read. */
  async create(command: CreateDocumentUseCase.Command): Promise<CreateDocumentUseCase.Result> {
    const { destination, ...opts } = command;
    if (opts.processId !== undefined) Doc.assertProcessId(opts.processId);
    const target = opts.out ?? destination;
    if (!opts.dryRun && !target) throw ioError('E_NO_FILE', 'No output file given');
    if (opts.mustNotExist) await this.save.assertNew(target, opts);
    const lint = await this.settings.lint(opts.file ?? target, opts);
    const conventions = opts.conventions ?? (await this.settings.idConventions(target, opts))?.conventions;
    const doc = Doc.create({ processName: opts.processName, processId: opts.processId, executable: opts.executable, target: opts.target, ...(conventions ? { conventions } : {}) }, destination);
    const result = await new EditBatchService(doc, [], lint.applyTo(opts, target)).run(target);
    if (!opts.dryRun && target) result.written = await this.save.save(target, result.xml, { source: doc.file, unchanged: result.unchanged, backup: opts.backup });
    result.changes.create(newProcessChange(doc, opts.processName));
    return result;
  }
}
