import { Doc } from '../../domain/document/Doc.js';
import { ioError } from '../../domain/document/utils/errors.js';
import type { EditDocumentUseCase } from '../port/in/EditDocumentUseCase.js';
import type { LoadDocumentPort } from '../port/out/LoadDocumentPort.js';
import type { LoadProjectSettingsPort } from '../port/out/LoadProjectSettingsPort.js';
import type { SaveDocumentPort } from '../port/out/SaveDocumentPort.js';
import { EditBatchService } from '../../domain/batch/EditBatchService.js';
import { TextPreservation, type PreservedText } from '../../domain/document/xml/TextPreservation.js';

export class EditDocumentService implements EditDocumentUseCase {
  constructor(
    private readonly settings: LoadProjectSettingsPort,
    private readonly load?: LoadDocumentPort,
    private readonly save?: SaveDocumentPort,
  ) {}

  private loadPort(file: string): LoadDocumentPort {
    if (!this.load) throw ioError('E_FILE_NOT_FOUND', `Cannot read ${file}: no such document`, { file });
    return this.load;
  }

  private savePort(): SaveDocumentPort {
    if (!this.save) throw ioError('E_NO_FILE', 'No output file given');
    return this.save;
  }

  async edit(command: EditDocumentUseCase.Command): Promise<EditDocumentUseCase.Result> {
    const { source, commands, ...opts } = command;
    const doc = 'doc' in source ? source.doc : await Doc.fromXml(await this.loadPort(source.file).read(source.file), source.file);
    doc.assertLossless(opts);
    const target = opts.out ?? doc.file;
    if (!opts.dryRun && !target) throw ioError('E_NO_FILE', 'No output file given');
    if (opts.mustNotExist) await this.save?.assertNew(target, opts);
    const lint = await this.settings.lint(opts.file ?? target, opts);
    const result = await new EditBatchService(doc, commands, lint.applyTo(opts, target)).run(target);
    if (!opts.dryRun && target) result.written = await this.savePort().save(target, result.xml, { source: doc.file, unchanged: result.unchanged, backup: opts.backup });
    return result;
  }

  preserveText(command: EditDocumentUseCase.PreserveTextCommand): Promise<PreservedText> {
    return new TextPreservation(command.original, command.baseline, command.next).result();
  }
}
