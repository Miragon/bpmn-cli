import { LayoutDebug } from '../diagram/layout/LayoutDebug.js';
import { Doc } from '../document/Doc.js';
import { modelError } from '../document/utils/errors.js';
import { EditSession } from '../document/EditSession.js';
import { reportedImportWarnings } from '../editing/utils/decision-link-warnings.js';
import { ModelCommands, type BatchRun } from './ModelCommands.js';
import { withoutProfileDuplicates } from '../validation/utils/finding-coverage.js';
import type { EditCommand } from '../commands/types.js';
import { PLATFORM_PROFILES } from '../validation/profiles/PlatformProfiles.js';
import type { ValidationResult } from '../validation/StructuralValidator.js';
import { FindingBaseline, type ValidationDelta } from '../validation/FindingBaseline.js';
import { ModelViewBuilder } from '../views/ModelViewBuilder.js';
import { BatchDrawing, type DrawingSegment } from '../diagram/BatchDrawing.js';
import { toBpmnError } from '../document/utils/bpmn-error.js';
import { utf8Declaration } from '../document/utils/encoding.js';
import { serializeWithout, unkeptEntries, withoutEntries } from '../document/utils/mirror.js';
import { TextPreservation } from '../document/xml/TextPreservation.js';
import type { ChangeSet } from '../document/ChangeSet.js';
import type { MutationOptions, MutationResult } from './types.js';
import type { LayoutStatus } from '../diagram/types.js';

/**
 * Runs one batch of edit commands on a document: guard, ops, validate, layout, format,
 * keep the file's text. Never touches the file system, so it runs in the browser too.
 * Only errors the ops introduce block the write; --force overrides every guard.
 */
export class EditBatch {
  private readonly edit: EditSession;

  /** An explicit `opts.platform` also decides the engine rules of the ops (event-gateway bridges). */
  constructor(
    private readonly doc: Doc,
    private readonly commands: EditCommand[],
    private readonly opts: MutationOptions = {},
  ) {
    const platformChoice = opts.platform && opts.platform !== 'auto' ? opts.platform : undefined;
    this.edit = new EditSession(doc, { conventions: opts.conventions, platformChoice, keepFlowIds: opts.keepFlowIds });
  }

  /**
   * Runs the batch on the document in memory; `file` is where its result goes. Throws a
   * BpmnError and leaves nothing half done: the caller keeps its input.
   */
  async run(file = this.doc.file): Promise<MutationResult> {
    return LayoutDebug.during(this.opts.debug, async () => {
      await this.guard();
      const asRead = await this.textAsRead();
      const diagram = await BatchDrawing.capture(this.doc, this.commands, this.opts, asRead, EditBatch.removeElements);
      const findings = await FindingBaseline.capture(this.doc, { platform: this.opts.platform, force: this.opts.force, validators: this.opts.validators, file: this.opts.file ?? this.doc.file, ops: this.commands });
      const importWarnings = reportedImportWarnings(this.doc).map((warning) => warning.message.split('\n')[0]!);
      const { batch, last } = await this.runCommands(diagram);
      await this.validateAndDropProfileDuplicates(findings, batch);
      const drawn = await diagram.apply(this.edit, batch.commands, batch.changes, last);
      const xml = await this.keptText(drawn.xml, asRead, batch.changes);
      const layout = drawn.layout;
      const validation = await findings.onCandidate(xml);
      return await this.result(file, batch, xml, layout, validation, findings.delta(), importWarnings);
    });
  }

  private static removeElements(doc: Doc, ids: string[]): void {
    new ModelCommands(doc).runBatch([{ op: 'remove', ids, ifExists: true }]);
  }

  /** Loads the platform profiles, a chunk of their own in a browser bundle, before anything runs. */
  private async guard(): Promise<void> {
    this.doc.assertLossless(this.opts);
    await PLATFORM_PROFILES.ensure(this.doc, this.opts.platform);
  }

  private async runCommands(diagram: BatchDrawing): Promise<{ batch: BatchRun; last?: DrawingSegment }> {
    let ran: { batch: BatchRun; last?: DrawingSegment };
    try {
      ran = await new ModelCommands(this.doc, this.edit).runBatchDrawnBetween(this.commands, diagram);
    } catch (err) {
      throw toBpmnError(err);
    }
    if (!this.opts.force) this.refuseDroppedContent();
    return ran;
  }

  /** The document as read, without the entries a caller's validateDoc added in memory. */
  private async textAsRead(): Promise<string | undefined> {
    const doc = this.doc;
    return doc.source ? await serializeWithout(doc.model, unkeptEntries(doc.definitions, doc.source.mirror)) : undefined;
  }

  /**
   * For a document read from a file, the parts the ops did not change keep their text. After a
   * forced lossy import the text is written plain, since the original text would bring back what
   * bpmn-moddle could not read. A kept XML declaration is changed to say UTF-8, as every write is.
   */
  private async keptText(xml: string, asRead: string | undefined, changes: ChangeSet): Promise<string> {
    const doc = this.doc;
    const source = doc.source;
    if (!source || asRead === undefined) return xml;
    const unkept = unkeptEntries(doc.definitions, source.mirror);
    if (unkept.length) xml = await withoutEntries(xml, unkept);
    const preservation = new TextPreservation(source.text, asRead, xml);
    const text = doc.lossyImportWarnings.length ? preservation.plain('the import was lossy') : await preservation.result();
    if (text.mode === 'plain') {
      const comments = text.droppedComments ? `; ${text.droppedComments} XML comment(s) dropped` : '';
      changes.note(`the file's formatting was not kept (${text.reason}): written as bpmn-moddle serialises it${comments}`);
    } else if (text.droppedComments) {
      changes.note(`${text.droppedComments} XML comment(s) dropped: they were inside or next to elements the change removed or rewrote`);
    }
    if (text.xml === source.text) return text.xml;
    const declared = utf8Declaration(text.xml);
    if (declared.was !== undefined) changes.note(`the XML declaration named the encoding ${declared.was}; the text is written as UTF-8, so it now says UTF-8`);
    return declared.text;
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

  private async validateAndDropProfileDuplicates(findings: FindingBaseline, batch: BatchRun): Promise<void> {
    const validation = await findings.afterCommands();
    batch.changes.warnings = withoutProfileDuplicates(batch.changes.warnings, validation.warnings);
  }

  /** The result carries no `delta` for a document created in memory: no warning was already there. */
  private async result(file: string | undefined, batch: BatchRun, xml: string, layout: LayoutStatus, validation: ValidationResult, delta: ValidationDelta | undefined, importWarnings: string[]): Promise<MutationResult> {
    const doc = this.doc;
    const unchanged = doc.source !== undefined && xml === doc.source.text;
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
      ...(delta ? { delta } : {}),
      xml,
    };
    if (this.opts.show) {
      const fresh = await Doc.fromXml(xml, file);
      result.view = new ModelViewBuilder(fresh).build();
    }
    return result;
  }
}
