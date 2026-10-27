import { Doc } from '../../domain/document/Doc.js';
import { ioError } from '../../domain/document/utils/errors.js';
import type { DocumentSource } from '../port/in/DocumentSource.js';
import type { EditDocumentUseCase, FileMutationOptions, FileWriteOptions } from '../port/in/EditDocumentUseCase.js';
import type { LoadDocumentPort } from '../port/out/LoadDocumentPort.js';
import type { LoadProjectSettingsPort } from '../port/out/LoadProjectSettingsPort.js';
import type { SaveDocumentPort } from '../port/out/SaveDocumentPort.js';
import { EditBatchService } from '../../domain/batch/EditBatchService.js';
import type { MutationResult } from '../../domain/batch/types.js';
import { TextPreservation, type PreservedText } from '../../domain/document/xml/TextPreservation.js';

export class EditDocumentService implements EditDocumentUseCase {
  constructor(
    private readonly settings: LoadProjectSettingsPort,
    private readonly load: LoadDocumentPort,
    private readonly save: SaveDocumentPort,
  ) {}

  async edit(command: EditDocumentUseCase.Command): Promise<EditDocumentUseCase.Result> {
    const { source, commands, ...opts } = command;
    const doc = await this.open(source, opts);
    const target = await this.targetOf(doc, opts);
    const project = (await this.settings.lint(opts.file ?? target, opts)).applyTo(opts, target);
    const result = await new EditBatchService(doc, commands, project).run(target);
    await this.write(result, doc, target, opts);
    return result;
  }

  preserveText(command: EditDocumentUseCase.PreserveTextCommand): Promise<PreservedText> {
    return new TextPreservation(command.original, command.baseline, command.next).result();
  }

  private async open(source: DocumentSource, opts: { force?: boolean }): Promise<Doc> {
    const doc = 'doc' in source ? source.doc : await Doc.fromXml(await this.load.read(source.file), source.file);
    doc.assertLossless(opts);
    return doc;
  }

  private async targetOf(doc: Doc, opts: FileMutationOptions): Promise<string | undefined> {
    const target = opts.out ?? doc.file;
    if (!opts.dryRun && !target) throw ioError('E_NO_FILE', 'No output file given');
    if (opts.mustNotExist) await this.save.assertNew(target, opts);
    return target;
  }

  private async write(result: MutationResult, doc: Doc, target: string | undefined, opts: FileWriteOptions): Promise<void> {
    if (!opts.dryRun && target) result.written = await this.save.save(target, result.xml, { source: doc.file, unchanged: result.unchanged, backup: opts.backup });
  }
}
