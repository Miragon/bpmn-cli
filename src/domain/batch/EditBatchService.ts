import { LayoutDebug } from '../diagram/layout/LayoutDebug.js';
import { Doc } from '../document/Doc.js';
import { modelError } from '../document/utils/errors.js';
import { EditContext } from '../document/EditContext.js';
import { reportedImportWarnings } from '../editing/utils/decision-link-warnings.js';
import { ModelCommandService, type BatchRun } from './ModelCommandService.js';
import { withoutProfileDuplicates } from '../editing/utils/covers.js';
import type { EditCommand } from '../commands/types.js';
import { PLATFORM_PROFILES } from '../validation/profiles/PlatformProfiles.js';
import type { ValidationResult } from '../validation/StructuralValidator.js';
import { FindingBaseline, type ValidationDelta } from '../validation/FindingBaseline.js';
import { ModelViewBuilder } from '../views/ModelViewBuilder.js';
import { BatchLayoutService, type DrawingSegment } from './BatchLayoutService.js';
import { toCliError } from '../document/utils/cli-error.js';
import type { LayoutStatus, MutationOptions, MutationResult } from './types.js';

/**
 * Runs one batch of edit commands on a document: guard, ops, validate, layout, format,
 * keep the file's text. Never touches the file system, so it runs in the browser too.
 * Only errors the ops introduce block the write; --force overrides every guard.
 */
export class EditBatchService {
  private readonly edit: EditContext;

  constructor(
    private readonly doc: Doc,
    private readonly ops: EditCommand[],
    private readonly opts: MutationOptions = {},
  ) {
    // an explicit platform also decides the engine rules of the ops (event-gateway bridges)
    const platformChoice = opts.platform && opts.platform !== 'auto' ? opts.platform : undefined;
    this.edit = new EditContext(doc, { conventions: opts.conventions, platformChoice, keepFlowIds: opts.keepFlowIds });
  }

  /**
   * Runs the batch on the document in memory; `file` is where its result goes. Throws a
   * CliError and leaves nothing half done: the caller keeps its input.
   */
  async run(file = this.doc.file): Promise<MutationResult> {
    return LayoutDebug.during(this.opts.debug, async () => {
      try {
        await this.guard();
        const diagram = await BatchLayoutService.capture(this.doc, this.ops, this.opts);
        const findings = await FindingBaseline.capture(this.doc, { platform: this.opts.platform, force: this.opts.force, validators: this.opts.validators, file: this.opts.file ?? this.doc.file, ops: this.ops });
        const importWarnings = reportedImportWarnings(this.doc).map((warning) => warning.message.split('\n')[0]!);
        const { batch, last } = await this.runOps(diagram);
        await this.validate(findings, batch);
        const { xml, layout } = await diagram.apply(this.edit, batch.ops, batch.changes, last);
        const validation = await findings.onCandidate(xml);
        return await this.result(file, batch, xml, layout, validation, findings.delta(), importWarnings);
      } finally {
        this.edit.close();
      }
    });
  }

  private async guard(): Promise<void> {
    this.doc.assertLossless(this.opts);
    // a chunk of its own in a browser bundle: loaded before anything runs
    await PLATFORM_PROFILES.ensure(this.doc, this.opts.platform);
  }

  /**
   * Runs the commands in batch order. Where a model command follows a diagram command the
   * drawing is brought up to date first, so every diagram command sees the commands before
   * it; `last` is then the segment the final layout still has to draw.
   */
  private async runOps(diagram: BatchLayoutService): Promise<{ batch: BatchRun; last?: DrawingSegment }> {
    const segments = BatchLayoutService.segmentsOf(this.ops);
    let batch: BatchRun;
    let last: DrawingSegment | undefined;
    try {
      const modelCommands = new ModelCommandService(this.doc, this.edit);
      modelCommands.beginBatch(this.ops);
      for (const [position, segment] of segments.entries()) {
        const before = new Set(modelCommands.changesSoFar.created.map((created) => this.doc.get(created.id)));
        modelCommands.runCommands(segment.start, segment.end);
        const created = modelCommands.changesSoFar.created.map((change) => change.id).filter((id) => !before.has(this.doc.get(id)));
        if (position === segments.length - 1) {
          if (segments.length > 1) last = { ...segment, created };
          break;
        }
        await diagram.drawBetween(this.edit, modelCommands.resolveDiagramCommands(), modelCommands.changesSoFar, { ...segment, created });
      }
      modelCommands.resolveDiagramCommands();
      batch = modelCommands.finishBatch();
    } catch (err) {
      throw toCliError(err);
    }
    if (!this.opts.force) this.refuseDroppedContent();
    return { batch, ...(last ? { last } : {}) };
  }

  /** A retype asks for another kind, not for a deletion. */
  private refuseDroppedContent(): void {
    const drops = this.edit.droppedContent;
    const first = drops[0];
    if (!first) return;
    const removed = drops.flatMap((drop) => drop.removed);
    const shown = removed.slice(0, 8).join(', ') + (removed.length > 8 ? ` and ${removed.length - 8} more` : '');
    throw modelError('E_WOULD_DROP_CONTENT', `Retyping ${first.element} to ${first.kind} would delete its content (${shown}); nothing was written`, {
      element: first.element,
      related: removed,
      hint: `A ${first.kind} cannot hold it. Move what should stay out first (\`bpmn move <file> <ids> --in <scopeId>\`), or pass --force to retype anyway (the listed elements are deleted).`,
    });
  }

  private async validate(findings: FindingBaseline, batch: BatchRun): Promise<void> {
    const validation = await findings.afterOps();
    batch.changes.warnings = withoutProfileDuplicates(batch.changes.warnings, validation.warnings);
  }

  private async result(file: string | undefined, batch: BatchRun, xml: string, layout: LayoutStatus, validation: ValidationResult, delta: ValidationDelta | undefined, importWarnings: string[]): Promise<MutationResult> {
    const doc = this.doc;
    const unchanged = doc.source !== undefined && xml === doc.source.text;
    const declared = this.edit.allocator.declaredIds.filter((id) => doc.has(id));
    const conventions = this.edit.conventions;
    const result: MutationResult = {
      ok: true,
      ...(file ? { file } : {}),
      written: false,
      unchanged,
      changes: batch.changes,
      ...(Object.keys(batch.aliases).length ? { aliases: batch.aliases } : {}),
      layout,
      validation,
      importWarnings,
      // absent for a document created in memory: no warning was already there
      ...(delta ? { delta } : {}),
      xml,
      ...(declared.length ? { conventions: { ids: [...new Set(declared)], ...(conventions?.source ? { source: conventions.source } : {}) } } : {}),
    };
    if (this.opts.show) {
      const fresh = await Doc.fromXml(xml, file);
      result.view = new ModelViewBuilder(fresh).build();
    }
    return result;
  }
}
