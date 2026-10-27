import { Doc } from '../../domain/document/Doc.js';
import { ioError, usageError } from '../../domain/document/utils/errors.js';
import { SUB_PROCESS_TYPES } from '../../domain/diagram/utils/expansion.js';
import { kindLabel } from '../../domain/document/utils/kinds.js';
import { EditBatchService } from '../../domain/batch/EditBatchService.js';
import { FullLayout, type LayoutResult } from '../../domain/diagram/layout/FullLayout.js';
import { LayoutDebug } from '../../domain/diagram/layout/LayoutDebug.js';
import type { FileLayoutOptions, LayoutDocOptions, RelayoutDiagramUseCase } from '../port/in/RelayoutDiagramUseCase.js';
import type { DocumentSource } from '../port/in/DocumentSource.js';
import type { FileWriteOptions } from '../port/in/EditDocumentUseCase.js';
import type { MutationResult } from '../../domain/batch/types.js';
import type { LoadDocumentPort } from '../port/out/LoadDocumentPort.js';
import type { LoadProjectSettingsPort } from '../port/out/LoadProjectSettingsPort.js';
import type { SaveDocumentPort } from '../port/out/SaveDocumentPort.js';

/** Ids that are no sub-process are errors, not silent no-ops. */
export class RelayoutDiagramService implements RelayoutDiagramUseCase {
  constructor(
    private readonly settings: LoadProjectSettingsPort,
    private readonly load: LoadDocumentPort,
    private readonly save: SaveDocumentPort,
  ) {}

  async relayout(command: RelayoutDiagramUseCase.Command): Promise<RelayoutDiagramUseCase.Result> {
    const { source, ...opts } = command;
    RelayoutDiagramService.assertOptions(opts);
    const doc = await this.open(source, opts);
    const target = await this.targetOf(doc, opts);
    const project = (await this.settings.lint(opts.file ?? target, opts)).applyTo(opts, target);
    const result = project.tidy ? await this.tidy(doc, project, target) : await this.redraw(doc, project, target);
    await this.write(result, doc, target, opts);
    return result;
  }

  layoutModel(command: RelayoutDiagramUseCase.ModelCommand): Promise<LayoutResult> {
    const { model, ...opts } = command;
    return new FullLayout(model, opts).run();
  }

  setDebugSink(command: RelayoutDiagramUseCase.DebugSinkCommand): void {
    LayoutDebug.setProcessSink(command.sink);
  }

  /** Checked before anything is read. */
  static assertOptions(opts: LayoutDocOptions): void {
    if (opts.tidy && (opts.expand !== undefined || opts.collapse !== undefined)) {
      throw usageError('--tidy keeps the drawing; --expand / --collapse need a redraw', { hint: 'Run `bpmn layout <file> --expand ...` and `bpmn layout <file> --tidy` separately.' });
    }
  }

  private tidy(doc: Doc, opts: LayoutDocOptions, target: string | undefined): Promise<MutationResult> {
    return new EditBatchService(doc, [{ op: 'tidy' }], { ...opts, layout: 'auto' }).run(target);
  }

  private async redraw(doc: Doc, opts: LayoutDocOptions, target: string | undefined): Promise<MutationResult> {
    const expand = opts.expand ?? [];
    const collapse = opts.collapse ?? [];
    const subs = new Map([...expand, ...collapse].map((id) => [id, doc.require(id, SUB_PROCESS_TYPES, 'sub-process')]));
    const both = expand.filter((id) => collapse.includes(id));
    if (both.length) throw usageError(`${both.join(', ')} given to both --expand and --collapse`);
    const result = await new EditBatchService(doc, [], { ...opts, layout: 'full', expand, collapse }).run(target);
    for (const [id, expanded] of [...expand.map((id) => [id, true] as const), ...collapse.map((id) => [id, false] as const)]) {
      const sub = subs.get(id)!;
      const name = sub.get<string | undefined>('name');
      result.changes.change({ id, kind: kindLabel(sub), ...(name ? { name } : {}), detail: `expanded=${expanded}` });
    }
    return result;
  }

  private async open(source: DocumentSource, opts: { force?: boolean }): Promise<Doc> {
    const doc = 'doc' in source ? source.doc : await Doc.fromXml(await this.load.read(source.file), source.file);
    doc.assertLossless(opts);
    return doc;
  }

  private async targetOf(doc: Doc, opts: FileLayoutOptions): Promise<string | undefined> {
    const target = opts.out ?? doc.file;
    if (!opts.dryRun && !target) throw ioError('E_NO_FILE', 'No output file given');
    if (opts.mustNotExist) await this.save.assertNew(target, opts);
    return target;
  }

  private async write(result: MutationResult, doc: Doc, target: string | undefined, opts: FileWriteOptions): Promise<void> {
    if (!opts.dryRun && target) result.written = await this.save.save(target, result.xml, { source: doc.file, unchanged: result.unchanged, backup: opts.backup });
  }
}
