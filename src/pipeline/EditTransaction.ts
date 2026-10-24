/**
 * The one write pipeline every mutating command uses:
 *
 *   load -> refuse lossy imports -> run ops -> validate -> layout -> format
 *   ops -> stickies -> keep the file's text -> validators -> atomic write
 *
 * Nothing is written when any stage fails, nor when the result equals the
 * file (`unchanged`; the node layer skips that write).
 *
 * Output text (outputText): incoming / outgoing entries are written the way
 * the file keeps them (model/utils/mirror.ts; in memory they are complete), and for a
 * document read from XML every element the ops did not change keeps its
 * original text (xml/TextPreservation.ts: prolog, comments, CDATA, attribute order,
 * namespace declarations, indentation); changed and new elements follow the
 * file's style. A write is UTF-8: a changed result whose XML declaration
 * names another encoding declares UTF-8 (src/xml/utils/encoding.ts, with a note). Comments the result cannot keep, and a fall-back to
 * bpmn-moddle's plain serialisation, are reported as notes. A result equal
 * to the input text is `unchanged: true`; the node layer does not write it
 * back over its file (`written: false`; `--out` to another file still writes
 * the copy).
 *
 * This class is the in-memory part (everything but load and write): it
 * never touches the file system or the environment, so it runs in the
 * browser too. src/node/ModelFile.ts reads the file, runs the transaction and writes
 * the result atomically (mutateFile, the CLI); src/api.ts wraps it for
 * strings (applyToXml).
 *
 * Guards (each overridden by MutationOptions.force / --force):
 *  - lossy import: a document bpmn-moddle dropped content from is refused
 *    with E_IMPORT_LOSSY, by loadDoc and again by mutateDoc, so the library
 *    path (Doc.fromXml + mutateDoc, XML from anywhere) is guarded like files.
 *  - dropped content: a retype whose new kind cannot hold the element's
 *    content (sub-process -> task) is refused with E_WOULD_DROP_CONTENT
 *    listing the ids it would delete (EditContext.droppedContent, recorded by ops/ElementRetyper.ts).
 *  - validation: the document is validated before and after the ops; only
 *    errors the ops introduce block the write (E_VALIDATION). Errors the
 *    document already had (same code and element) do not block unrelated
 *    edits: they are reported as W_PREEXISTING_ERROR warnings whose message
 *    starts with the original code.
 *  - platform profile (src/platform/, MutationOptions.platform, default
 *    auto-detected): only the findings the ops introduce are reported, as
 *    warnings; `validation.platform` has them as `added`, the ones the ops
 *    removed as `resolved`, and the totals (`bpmn validate` lists them all).
 *    An op warning that the added findings repeat item by item is dropped
 *    (retype's W_PROPERTY_INAPPLICABLE, ops/utils/covers.ts withoutProfileDuplicates).
 *  - validators (src/validate/validators.ts, MutationOptions.validators): each runs
 *    on the document before the ops and on the candidate XML after the
 *    layout, the format ops and the text-preserving step, i.e. on exactly
 *    what would be written. Errors the change introduced block the write
 *    (E_VALIDATION, each finding names its validator); errors the document
 *    already had are W_PREEXISTING_ERROR warnings; introduced warnings are
 *    reported (`validation.validators`).
 *    An advisory validator (`blocks: false`: the project's bpmnlint, which
 *    the node layer adds for a .bpmnlintrc) reports the errors the change
 *    introduced among the warnings and never blocks; for a created document
 *    (`new`) it reports everything it finds in the new model.
 *
 * Declared id conventions (MutationOptions.conventions, src/ids/IdConventionsReader.ts:
 * element-id-naming of the project's .bpmnlintrc, which the node layer reads)
 * are the document's for the call: the ids the ops and a full redraw
 * generate follow them where they declare a prefix (src/ids/IdStyle.ts); the
 * result names those that differ from the file's own style
 * (`conventions`). Without them nothing changes.
 *
 * Layout modes (MutationOptions.layout):
 *  - false: skip; the DI of removed elements is pruned, new elements have none,
 *    and a flow whose ends changed loses its edge (layout/IncrementalLayout.ts
 *    pruneReEnded; kept when it already reaches its new ends, and on the
 *    root's first diagram while a new end has no shape: the next write places
 *    that end and routes the flow); a note counts what was removed
 *  - 'full': redraw everything with the engine (clean or auto); bpmn-js
 *    colours (bioc:/color:) and the drawing's DI ids are carried over by
 *    element id (layoutModel, diagram/DiIdMemo.ts; plane and
 *    diagram ids by root; new DI gets the file's DI id style). An element
 *    the redraw draws that has no id (a hand-written message flow, pool,
 *    process, collaboration) first gets one in the file's id style and
 *    registry (diagram/DrawnElementIds.ts), reported as a change and a note.
 *    A group box is drawn again around the elements it held
 *    (diagram/Groups.ts); one with none of them drawn keeps its box (or
 *    its size below the drawing when the redraw put shapes on it), a
 *    layout note says so
 *  - 'incremental': keep every existing shape and connection, place what is
 *    new, prune what is gone, reroute only affected connections
 *    (src/layout/IncrementalLayout.ts); a file without any diagram is drawn in full
 *  - 'auto' (default, also `true`): full when the layout root had no flow node
 *    DI before the ops, or when the drawing is engine-owned (re-running the
 *    clean engine on the model as it was before the ops reproduces every
 *    shape, label and connection within 2 px; flow nodes without a shape, e.g.
 *    added with --no-layout, are removed from that model first, bridged like
 *    `remove`; with --engine auto also that engine); otherwise incremental.
 *    If the incremental layout fails, auto falls back to full.
 * The result reports the mode, why it ran, what the incremental engine
 * placed / moved / rerouted / pruned, and the layout problems before / after
 * (src/diagram/LayoutAnalysis.ts) with the problems added and resolved.
 *
 * Format ops (place, align, color, label, route, space, tidy, and the lane
 * part of `order`; src/format/FormatOps.ts) run after the layout, on its result,
 * in batch order; a failing one fails the whole batch. A batch of format ops
 * only keeps the drawing (no layout runs) unless `full` is requested or the
 * file has no diagram yet; with --no-layout they run on the existing DI.
 * Their results are reported in `layout.format`, and `layout.metrics`
 * measures after them. A format op that changes the geometry (also a route
 * or a label side) makes the drawing hand-made, so later `auto` writes keep
 * it; colours survive full redraws.
 *
 * design-iq stickies (`bpmiq:sticky` extension elements with absolute
 * coordinates, src/diagram/Stickies.ts) follow the flow node nearest to them
 * before the ops by the shift of its centre, after the layout and the format
 * ops, whatever moved it (incremental placement, a format op, a redraw); a
 * write that moves no node leaves them untouched. `layout.stickies` lists
 * the stickies that moved.
 */
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
 * One mutateDoc call: applies ops to an in-memory document, the whole
 * pipeline except reading and writing (src/node/ModelFile.ts mutateFile /
 * mutateDocToFile write the result), in the edit context of the call
 * (src/model/EditContext.ts: its declared conventions, explicit platform and
 * keepFlowIds).
 */
export class EditTransaction {
  private readonly edit: EditContext;

  constructor(
    private readonly doc: Doc,
    private readonly ops: Op[],
    private readonly opts: MutationOptions = {},
  ) {
    // an explicit platform decides the engine rules of the ops too (event-gateway bridges, defaults of new processes)
    const platformChoice = opts.platform && opts.platform !== 'auto' ? opts.platform : undefined;
    this.edit = new EditContext(doc, { conventions: opts.conventions, platformChoice, keepFlowIds: opts.keepFlowIds });
  }

  /**
   * Returns the new XML and what changed; `written` is false. Throws a CliError
   * (E_IMPORT_LOSSY, E_VALIDATION, E_WOULD_DROP_CONTENT, the ops' own codes)
   * and leaves nothing half done: the caller keeps its input when it throws.
   */
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
    // the engine rules of the file's platform (a chunk of its own in a browser bundle): loaded before anything runs
    await PLATFORM_PROFILES.ensure(this.doc, this.opts.platform);
  }

  /** Runs the batch (its ops with their aliases resolved are what the layout and the format phase run); refuses the content retypes would delete. */
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

  /** Refuses content that retypes deleted (the agent asked for another kind, not for a deletion). */
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

  /** The structural and platform findings after the ops (FindingBaseline.afterOps refuses what they introduced); an op warning the added platform findings repeat item by item (retype: W_PROPERTY_INAPPLICABLE) is reported once. */
  private async validate(findings: FindingBaseline, batch: BatchRun): Promise<void> {
    const validation = await findings.afterOps();
    batch.changes.warnings = withoutProfileDuplicates(batch.changes.warnings, validation.warnings);
  }

  private async result(batch: BatchRun, xml: string, layout: LayoutStatus, validation: ValidationResult, delta: ValidationDelta | undefined, importWarnings: string[]): Promise<MutationResult> {
    const doc = this.doc;
    const unchanged = doc.source !== undefined && xml === doc.source.text;
    // the generated ids under a declared prefix that the file's style would give otherwise (the ones the change kept)
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
      // a document created in memory (`new`) has no file whose warnings were already there: everything is reported
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
