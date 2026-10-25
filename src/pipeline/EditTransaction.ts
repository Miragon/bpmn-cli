import { LayoutDebug } from '../shared/LayoutDebug.js';
import { Doc } from '../model/Doc.js';
import { modelError } from '../shared/utils/errors.js';
import { EditContext } from '../model/EditContext.js';
import { reportedImportWarnings } from '../ops/utils/decision-link-warnings.js';
import { OpRunner, type BatchRun } from '../ops/OpRunner.js';
import { withoutProfileDuplicates } from '../ops/utils/covers.js';
import type { Op } from '../ops/types.js';
import { PLATFORM_PROFILES } from '../platform/profiles/PlatformProfiles.js';
import type { ValidationResult } from '../validate/StructuralValidator.js';
import { FindingBaseline, type ValidationDelta } from '../validate/FindingBaseline.js';
import { ModelViewBuilder } from '../query/ModelViewBuilder.js';
import { DiagramUpdate } from './DiagramUpdate.js';
import { toCliError } from './utils/cli-error.js';
import type { LayoutStatus, MutationOptions, MutationResult } from './index.js';

/**
 * The in-memory write pipeline of one mutateDoc call: guard, ops, validate, layout, format,
 * keep the file's text. Never touches the file system, so it runs in the browser too.
 * Only errors the ops introduce block the write; --force overrides every guard.
 */
export class EditTransaction {
  private readonly edit: EditContext;

  constructor(
    private readonly doc: Doc,
    private readonly ops: Op[],
    private readonly opts: MutationOptions = {},
  ) {
    // an explicit platform also decides the engine rules of the ops (event-gateway bridges)
    const platformChoice = opts.platform && opts.platform !== 'auto' ? opts.platform : undefined;
    this.edit = new EditContext(doc, { conventions: opts.conventions, platformChoice, keepFlowIds: opts.keepFlowIds });
  }

  /** Throws a CliError and leaves nothing half done: the caller keeps its input. */
  async run(): Promise<MutationResult> {
    return LayoutDebug.during(this.opts.debug, async () => {
      try {
        await this.guard();
        const diagram = await DiagramUpdate.capture(this.doc, this.ops, this.opts);
        const findings = await FindingBaseline.capture(this.doc, { platform: this.opts.platform, force: this.opts.force, validators: this.opts.validators, file: this.opts.file ?? this.doc.file, ops: this.ops });
        const importWarnings = reportedImportWarnings(this.doc).map((w) => w.message.split('\n')[0]!);
        const batch = this.runOps();
        await this.validate(findings, batch);
        const { xml, layout } = await diagram.apply(this.edit, batch.ops, batch.changes);
        const validation = await findings.onCandidate(xml);
        return await this.result(batch, xml, layout, validation, findings.delta(), importWarnings);
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

  private runOps(): BatchRun {
    let batch: BatchRun;
    try {
      batch = new OpRunner(this.doc, this.edit).runBatch(this.ops);
    } catch (err) {
      throw toCliError(err);
    }
    if (!this.opts.force) this.refuseDroppedContent();
    return batch;
  }

  /** A retype asks for another kind, not for a deletion. */
  private refuseDroppedContent(): void {
    const drops = this.edit.droppedContent;
    const first = drops[0];
    if (!first) return;
    const removed = drops.flatMap((d) => d.removed);
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

  private async result(batch: BatchRun, xml: string, layout: LayoutStatus, validation: ValidationResult, delta: ValidationDelta | undefined, importWarnings: string[]): Promise<MutationResult> {
    const doc = this.doc;
    const unchanged = doc.source !== undefined && xml === doc.source.text;
    const declared = this.edit.allocator.declaredIds.filter((id) => doc.has(id));
    const conventions = this.edit.conventions;
    const result: MutationResult = {
      ok: true,
      ...(doc.file ? { file: doc.file } : {}),
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
      const fresh = await Doc.fromXml(xml, doc.file);
      result.view = new ModelViewBuilder(fresh).build();
    }
    return result;
  }
}
