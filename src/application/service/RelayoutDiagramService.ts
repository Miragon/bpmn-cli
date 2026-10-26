import { Doc } from '../../domain/document/Doc.js';
import { ioError, usageError } from '../../domain/document/utils/errors.js';
import { SUB_PROCESS_TYPES } from '../../domain/diagram/utils/expansion.js';
import { kindLabel } from '../../domain/document/utils/kinds.js';
import { EditBatchService } from '../../domain/batch/EditBatchService.js';
import type { LayoutDocOptions, RelayoutDiagramUseCase } from '../port/in/RelayoutDiagramUseCase.js';
import type { FileWriteOptions } from '../port/in/EditDocumentUseCase.js';
import type { MutationResult } from '../../domain/batch/types.js';
import type { LoadDocumentPort } from '../port/out/LoadDocumentPort.js';
import type { LoadProjectSettingsPort } from '../port/out/LoadProjectSettingsPort.js';
import type { SaveDocumentPort } from '../port/out/SaveDocumentPort.js';

/** Ids that are no sub-process are errors, not silent no-ops. */
export class RelayoutDiagramService implements RelayoutDiagramUseCase {
  constructor(
    private readonly load: LoadDocumentPort,
    private readonly save: SaveDocumentPort,
    private readonly settings: LoadProjectSettingsPort,
  ) {}

  async relayout(command: RelayoutDiagramUseCase.Command): Promise<RelayoutDiagramUseCase.Result> {
    const { source, ...opts } = command;
    RelayoutDiagramService.assertOptions(opts);
    const doc = 'doc' in source ? source.doc : await Doc.fromXml(await this.load.read(source.file), source.file);
    doc.assertLossless(opts);
    const target = opts.out ?? doc.file;
    if (!opts.dryRun && !target) throw ioError('E_NO_FILE', 'No output file given');
    if (opts.mustNotExist) await this.save.assertNew(target, opts);
    const project = (await this.settings.lint(opts.file ?? target, opts)).applyTo(opts, target);
    if (project.tidy) return this.write(doc, new EditBatchService(doc, [{ op: 'tidy' }], { ...project, layout: 'auto' }), target, opts);
    return this.redraw(doc, project, target, opts);
  }

  /** Checked before anything is read. */
  static assertOptions(opts: LayoutDocOptions): void {
    if (opts.tidy && (opts.expand !== undefined || opts.collapse !== undefined)) {
      throw usageError('--tidy keeps the drawing; --expand / --collapse need a redraw', { hint: 'Run `bpmn layout <file> --expand ...` and `bpmn layout <file> --tidy` separately.' });
    }
  }

  private async redraw(doc: Doc, opts: LayoutDocOptions, target: string | undefined, write: FileWriteOptions): Promise<MutationResult> {
    const expand = opts.expand ?? [];
    const collapse = opts.collapse ?? [];
    const subs = new Map([...expand, ...collapse].map((id) => [id, doc.require(id, SUB_PROCESS_TYPES, 'sub-process')]));
    const both = expand.filter((id) => collapse.includes(id));
    if (both.length) throw usageError(`${both.join(', ')} given to both --expand and --collapse`);
    const result = await this.write(doc, new EditBatchService(doc, [], { ...opts, layout: 'full', expand, collapse }), target, write);
    for (const [id, expanded] of [...expand.map((id) => [id, true] as const), ...collapse.map((id) => [id, false] as const)]) {
      const sub = subs.get(id)!;
      const name = sub.get<string | undefined>('name');
      result.changes.change({ id, kind: kindLabel(sub), ...(name ? { name } : {}), detail: `expanded=${expanded}` });
    }
    return result;
  }

  private async write(doc: Doc, batch: EditBatchService, target: string | undefined, opts: FileWriteOptions): Promise<MutationResult> {
    const result = await batch.run(target);
    if (!opts.dryRun && target) result.written = await this.save.save(target, result.xml, { source: doc.file, unchanged: result.unchanged, backup: opts.backup });
    return result;
  }
}
