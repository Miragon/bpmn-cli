import { Doc } from '../../domain/document/Doc.js';
import { usageError } from '../../domain/document/utils/errors.js';
import { SUB_PROCESS_TYPES } from '../../domain/diagram/utils/expansion.js';
import { kindLabel } from '../../domain/document/Kinds.js';
import { EditBatch } from '../../domain/batch/EditBatch.js';
import { FullLayout, type LayoutResult } from '../../domain/diagram/layout/FullLayout.js';
import { LayoutDebug } from '../../domain/diagram/layout/LayoutDebug.js';
import type { LayoutDocOptions, RelayoutDiagramUseCase } from '../port/in/RelayoutDiagramUseCase.js';
import type { MutationResult } from '../../domain/batch/types.js';
import type { DocumentPort } from '../port/out/DocumentPort.js';
import type { EngineLintPort } from '../port/out/EngineLintPort.js';
import type { LoadProjectSettingsPort } from '../port/out/LoadProjectSettingsPort.js';

/** Ids that are no sub-process are errors, not silent no-ops. */
export class RelayoutDiagramService implements RelayoutDiagramUseCase {
  constructor(
    private readonly settings: LoadProjectSettingsPort,
    private readonly documents: DocumentPort,
    private readonly engine: EngineLintPort,
  ) {}

  async relayout(command: RelayoutDiagramUseCase.Command): Promise<RelayoutDiagramUseCase.Result> {
    const { source, ...opts } = command;
    RelayoutDiagramService.assertOptions(opts);
    const doc = await this.documents.load(source, { ...opts, lossless: true });
    const target = await this.documents.target(doc.file, opts);
    const project = (await this.settings.lint(opts.file ?? target, opts)).applyTo({ engine: this.engine, ...opts }, target);
    const result = project.tidy ? await this.tidy(doc, project, target) : await this.redraw(doc, project, target);
    await this.documents.save(result, doc, target, opts);
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
    return new EditBatch(doc, [{ op: 'tidy' }], { ...opts, layout: 'auto' }).run(target);
  }

  private async redraw(doc: Doc, opts: LayoutDocOptions, target: string | undefined): Promise<MutationResult> {
    const expand = opts.expand ?? [];
    const collapse = opts.collapse ?? [];
    const subs = new Map([...expand, ...collapse].map((id) => [id, doc.require(id, SUB_PROCESS_TYPES, 'sub-process')]));
    const both = expand.filter((id) => collapse.includes(id));
    if (both.length) {
      throw usageError(`${both.join(', ')} given to both --expand and --collapse`);
    }
    const result = await new EditBatch(doc, [], { ...opts, layout: 'full', expand, collapse }).run(target);
    for (const [id, expanded] of [...expand.map((id) => [id, true] as const), ...collapse.map((id) => [id, false] as const)]) {
      const sub = subs.get(id)!;
      const name = sub.get<string | undefined>('name');
      result.changes.change({ id, kind: kindLabel(sub), ...(name ? { name } : {}), detail: `expanded=${expanded}` });
    }
    return result;
  }
}
