import { Doc } from '../../domain/document/Doc.js';
import { ioError } from '../../domain/document/utils/errors.js';
import type { EditDocumentUseCase } from '../port/in/EditDocumentUseCase.js';
import type { LoadDocumentPort } from '../port/out/LoadDocumentPort.js';
import type { LoadProjectSettingsPort } from '../port/out/LoadProjectSettingsPort.js';
import type { SaveDocumentPort } from '../port/out/SaveDocumentPort.js';
import { EditBatchService } from '../../domain/batch/EditBatchService.js';

export class EditDocumentService implements EditDocumentUseCase {
  constructor(
    private readonly load: LoadDocumentPort,
    private readonly save: SaveDocumentPort,
    private readonly settings: LoadProjectSettingsPort,
  ) {}

  async edit(command: EditDocumentUseCase.Command): Promise<EditDocumentUseCase.Result> {
    const { source, commands, ...opts } = command;
    const doc = 'doc' in source ? source.doc : await Doc.fromXml(await this.load.read(source.file), source.file);
    doc.assertLossless(opts);
    const target = opts.out ?? doc.file;
    if (!opts.dryRun && !target) throw ioError('E_NO_FILE', 'No output file given');
    if (opts.mustNotExist) await this.save.assertNew(target, opts);
    const lint = await this.settings.lint(opts.file ?? target, opts);
    const result = await new EditBatchService(doc, commands, lint.applyTo(opts, target)).run(target);
    if (!opts.dryRun && target) result.written = await this.save.save(target, result.xml, { source: doc.file, unchanged: result.unchanged, backup: opts.backup });
    return result;
  }
}
