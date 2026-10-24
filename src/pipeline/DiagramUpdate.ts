/**
 * What a write does to the drawing (see the layout modes, format ops and
 * stickies in pipeline/EditTransaction.ts) and the text it writes: captured before the
 * ops run (capture), applied after them (apply).
 */
import { utf8Declaration } from '../xml/utils/encoding.js';
import { Doc } from '../model/Doc.js';
import { CliError } from '../shared/CliError.js';
import { layoutModel, SUB_PROCESS_TYPES, type LayoutEngine } from '../layout/index.js';
import type { GivenId } from '../diagram/drawn-ids.js';
import { diagramGeometry, engineOwned, layoutIncremental, pruneReEnded, takeSnapshot, type IncrementalReport, type Snapshot } from '../layout/incremental.js';
import { layoutProblems, metricsDelta, type LayoutMetrics } from '../diagram/metrics.js';
import { runFormatOps, type FormatEntry, type FormatResult } from '../format/index.js';
import { followStickies, stickyAnchors, type ResolvedAnchor, type StickyAnchor } from '../diagram/stickies.js';
import { applyColors, colorsOf, diIds } from '../diagram/write.js';
import { redrawGroups, undrawnGroups } from '../diagram/groups.js';
import { serializeWithout, unkeptEntries, withoutEntries } from '../model/utils/mirror.js';
import { addTo, is, layoutRoot, many, parseXml, serialize, type El } from '../model/utils/moddle.js';
import { ModelError } from '../model/ModelError.js';
import type { EditContext } from '../model/EditContext.js';
import type { ChangeSet } from '../model/ChangeSet.js';
import { OpRunner } from '../ops/OpRunner.js';
import { ordersLanes, ordersPools } from '../ops/order.js';
import { isFormatOp, type Op } from '../ops/types.js';
import { TextPreservation } from '../xml/TextPreservation.js';
import { firstLine } from '../shared/utils/text.js';
import { toCliError } from './utils/cli-error.js';
import type { LayoutMode, LayoutStatus, MutationOptions } from './index.js';

interface Before {
  snapshot: Snapshot;
  /** the node each design-iq sticky follows */
  stickies: StickyAnchor[];
  /** the model before the ops (only for the ownership check of auto mode) */
  xml?: string;
  metrics?: LayoutMetrics;
}

/** A layout that ran: its XML, status and the problems after it, and the ids a full redraw gave elements that had none. */
interface Ran {
  xml: string;
  status: LayoutStatus;
  after: LayoutMetrics;
  givenIds?: GivenId[];
}

export class DiagramUpdate {
  private constructor(
    private readonly doc: Doc,
    private readonly opts: MutationOptions,
    /** the normalised layout request */
    private readonly requested: LayoutMode | 'skip',
    /** format ops only: nothing semantic changes */
    private readonly formatOnly: boolean,
    private readonly before: Before,
    /** the document as read (entries a caller's validateDoc added in memory left out): unchanged parts keep their text */
    private readonly asRead: string | undefined,
  ) {}

  /** The drawing before the ops: its snapshot, the stickies' anchors, its layout problems and (auto mode) the model to check ownership with. */
  static async capture(doc: Doc, ops: Op[], opts: MutationOptions): Promise<DiagramUpdate> {
    const asRead = doc.source ? await serializeWithout(doc.model, unkeptEntries(doc.definitions, doc.source.mirror)) : undefined;
    const requested = opts.layout === false ? 'skip' : opts.layout === undefined || opts.layout === true ? 'auto' : opts.layout;
    const formatOnly = ops.length > 0 && ops.every(isFormatOp);
    const snapshot = takeSnapshot(doc.definitions);
    const hasDiagram = many(doc.definitions, 'diagrams').length > 0 && snapshot.byDi.size > 0;
    const before: Before = { snapshot, stickies: stickyAnchors(doc.definitions) };
    if (hasDiagram) before.metrics = layoutProblems(doc.definitions);
    if (requested === 'auto' && !formatOnly && snapshot.flowNodeShapes > 0) before.xml = asRead ?? (await doc.toXml());
    return new DiagramUpdate(doc, opts, requested, formatOnly, before, asRead);
  }

  /**
   * Updates the drawing after the ops (`ran`: with their batch aliases
   * resolved; `edit`: ids a redraw gives come from it): the layout, the
   * format ops, the stickies; returns the text to write and the layout
   * status. Notes go to `changes`.
   */
  async apply(edit: EditContext, ran: Op[], changes: ChangeSet): Promise<{ xml: string; layout: LayoutStatus }> {
    const doc = this.doc;
    let xml: string;
    let layout: LayoutStatus;
    // format ops only, on the drawing as the file has it: the first one's refusal may name a command to run on the file
    let fileDrawing = false;
    if (this.requested === 'skip') {
      const pruned = this.pruneDanglingDi();
      // the edge of a flow whose ends changed shows the old ends: removed too, the next write draws the flow like a new one
      const reEnded = pruneReEnded(doc.definitions, this.before.snapshot);
      if (pruned || reEnded.length) changes.note(DiagramUpdate.staleDiNote(pruned, reEnded));
      this.persistExpansionHints(doc.layoutRequests.expansion(this.opts));
      xml = await doc.toXml();
      layout = { status: 'skipped', warnings: [], expanded: [], metrics: metricsDelta(this.before.metrics, layoutProblems(doc.definitions)) };
    } else if (this.formatOnly && this.requested !== 'full' && this.before.snapshot.flowNodeShapes > 0) {
      // nothing semantic changed: the drawing is kept as it is and only formatted
      xml = await doc.toXml();
      fileDrawing = true;
      layout = { status: 'ok', mode: 'incremental', reason: 'format operations only: drawing kept', warnings: [], expanded: [] };
    } else {
      let givenIds: GivenId[] | undefined;
      try {
        ({ xml, layout, givenIds } = await this.runLayout(edit, this.requested, DiagramUpdate.relocatedIds(ran, changes), changes.created.map((c) => c.id)));
      } catch (err) {
        throw toCliError(err);
      }
      if (givenIds?.length) {
        for (const g of givenIds) changes.change({ id: g.id, kind: g.kind, ...(g.name ? { name: g.name } : {}), detail: 'id added (it had none; the diagram refers to elements by id)' });
        changes.note(`${givenIds.length} element(s) without id got one in the file's id style so that the redrawn diagram can show them: ${givenIds.map((g) => g.id).join(', ')}`);
      }
    }

    const entries = this.formatEntries(ran);
    if (entries.length) {
      const formatted = await DiagramUpdate.runFormat(xml, doc.file, entries, fileDrawing);
      xml = formatted.xml;
      layout.format = formatted.results;
      layout.metrics = metricsDelta(this.before.metrics, formatted.after);
    }
    const followed = await DiagramUpdate.moveStickies(xml, this.resolveAnchors());
    xml = followed.xml;
    if (followed.moved.length) layout.stickies = followed.moved;

    return { xml: await this.outputText(xml, changes), layout };
  }

  /** The note of a --no-layout write that removed stale DI: `pruned` of removed elements, the edges of the flows `reEnded` (their ends changed). */
  private static staleDiNote(pruned: number, reEnded: string[]): string {
    const removed = `removed ${pruned + reEnded.length} stale diagram element(s)`;
    const flows = [...new Set(reEnded)];
    if (!flows.length) return `${removed}; run \`bpmn layout <file>\` to redraw`;
    const shown = flows.slice(0, 8).join(', ') + (flows.length > 8 ? ` and ${flows.length - 8} more` : '');
    return `${removed}, among them the edge(s) of ${shown} (their ends changed; the next model edit without --no-layout draws them, or \`bpmn route <file> <flowId>\`)`;
  }

  /** Removes DI shapes/edges whose semantic element no longer exists (used with --no-layout). */
  private pruneDanglingDi(): number {
    const index = this.doc.byId();
    let removed = 0;
    for (const diagram of many(this.doc.definitions, 'diagrams')) {
      const plane = diagram.get<El | undefined>('plane');
      if (!plane) continue;
      const elements = many(plane, 'planeElement');
      for (let i = elements.length - 1; i >= 0; i--) {
        const target = elements[i]!.get<El | undefined>('bpmnElement');
        const id = target?.get<string | undefined>('id');
        if (!target || !id || index.get(id) !== target) {
          elements.splice(i, 1);
          removed++;
        }
      }
    }
    return removed;
  }

  /**
   * With --no-layout the expansion requests (`set expanded=`, `add --collapsed`,
   * `layout --collapse/--expand`) would otherwise be lost: they live in
   * the document's layout requests (Doc.layoutRequests) that only the
   * layouter reads. Record them in the existing DI so the next layout picks
   * them up (see diExpansionState).
   */
  private persistExpansionHints(expansion: { expand: string[]; collapse: string[] }): void {
    const doc = this.doc;
    const wanted = new Map<string, boolean>();
    for (const id of expansion.expand) wanted.set(id, true);
    for (const id of expansion.collapse) wanted.set(id, false);
    if (!wanted.size) return;
    const shapes = new Map<string, El>();
    let rootPlane: El | undefined;
    for (const diagram of many(doc.definitions, 'diagrams')) {
      const plane = diagram.get<El | undefined>('plane');
      if (!plane) continue;
      rootPlane ??= plane;
      for (const shape of many(plane, 'planeElement')) {
        const id = shape.get<El | undefined>('bpmnElement')?.get<string | undefined>('id');
        if (id && is(shape, 'bpmndi:BPMNShape')) shapes.set(id, shape);
      }
    }
    let newDi: ReturnType<typeof diIds> | undefined;
    for (const [id, expanded] of wanted) {
      const sub = doc.get(id);
      if (!sub || !SUB_PROCESS_TYPES.some((t) => is(sub, t))) continue;
      const existing = shapes.get(id);
      if (existing) {
        existing.set('isExpanded', expanded);
        continue;
      }
      if (expanded) continue; // expanded is the default when no shape records anything
      if (!rootPlane) {
        const root = layoutRoot(doc.definitions);
        if (!root) continue;
        // the engine's plane and diagram ids, a long root id cut (diagram/write.ts diIds)
        newDi ??= diIds(doc.definitions);
        rootPlane = doc.moddle.create('bpmndi:BPMNPlane', { id: newDi.plane(root.get<string>('id')), bpmnElement: root });
        const diagram = doc.moddle.create('bpmndi:BPMNDiagram', { id: newDi.diagram(root.get<string>('id')), plane: rootPlane });
        rootPlane.$parent = diagram;
        addTo(doc.definitions, 'diagrams', diagram);
      }
      // a placeholder shape (redrawn by the next layout) so the collapse survives the stale diagram; its id in the file's DI style
      const shape = doc.moddle.create('bpmndi:BPMNShape', {
        id: (newDi ??= diIds(doc.definitions)).shape(id),
        bpmnElement: sub,
        isExpanded: false,
        bounds: doc.moddle.create('dc:Bounds', { x: 0, y: 0, width: 100, height: 80 }),
      });
      addTo(rootPlane, 'planeElement', shape);
    }
    doc.invalidate();
  }

  /**
   * Nodes the ops re-insert elsewhere (move with a placement): the incremental
   * engine places them again. A node a move left where it was (`move B
   * --after A` with A -> B, `--in` its own scope; ChangeSet.relocated does not
   * list it) keeps its place in the drawing.
   */
  private static relocatedIds(ops: Op[], changes: ChangeSet): string[] {
    const moved = new Set(changes.relocated);
    const out: string[] = [];
    for (const op of ops) {
      if (op.op === 'move' && (op.after || op.before || op.flow || op.in)) out.push(...op.ids.filter((id) => moved.has(id)));
    }
    return out;
  }

  /**
   * The text a mutation writes. The mirror entries the file does not keep are
   * left out (model/utils/mirror.ts). For a document read from a file, the parts the ops
   * did not change keep their original text (xml/preserve.ts; asRead is the
   * serialisation of the document as read); comments that could not be kept
   * and a fall-back to the plain serialisation are reported as notes.
   */
  private async outputText(xml: string, changes: ChangeSet): Promise<string> {
    const doc = this.doc;
    const source = doc.source;
    if (!source || this.asRead === undefined) return xml;
    const unkept = unkeptEntries(doc.definitions, source.mirror);
    if (unkept.length) xml = await withoutEntries(xml, unkept);
    // a forced write of a lossy import drops what bpmn-moddle could not read: the original text would keep it
    const preservation = new TextPreservation(source.text, this.asRead, xml);
    const text = doc.lossyImportWarnings.length ? preservation.plain('the import was lossy') : await preservation.result();
    if (text.mode === 'plain') {
      const comments = text.droppedComments ? `; ${text.droppedComments} XML comment(s) dropped` : '';
      changes.note(`the file's formatting was not kept (${text.reason}): written as bpmn-moddle serialises it${comments}`);
    } else if (text.droppedComments) {
      changes.note(`${text.droppedComments} XML comment(s) dropped: they were inside or next to elements the change removed or rewrote`);
    }
    if (text.xml === source.text) return text.xml;
    // a write is UTF-8 (src/xml/encoding.ts): the kept declaration must say so
    const declared = utf8Declaration(text.xml);
    if (declared.was !== undefined) changes.note(`the XML declaration named the encoding ${declared.was}; the text is written as UTF-8, so it now says UTF-8`);
    return declared.text;
  }

  /** The anchors of the stickies with the ids their process and node have after the ops (removed ones are left out). */
  private resolveAnchors(): ResolvedAnchor[] {
    const out: ResolvedAnchor[] = [];
    for (const a of this.before.stickies) {
      const processId = a.process.get<string | undefined>('id');
      const nodeId = a.node.get<string | undefined>('id');
      if (!processId || !nodeId || this.doc.get(processId) !== a.process || !this.doc.get(nodeId)) continue;
      out.push({ processId, index: a.index, ...(a.stickyId !== undefined ? { stickyId: a.stickyId } : {}), nodeId, centre: a.centre });
    }
    return out;
  }

  /** Moves the stickies of the written XML with their nodes; returns the new XML and what moved. */
  private static async moveStickies(xml: string, anchors: ResolvedAnchor[]): Promise<{ xml: string; moved: Array<{ sticky: string; node: string }> }> {
    if (!anchors.length) return { xml, moved: [] };
    const model = await parseXml(xml);
    const moved = followStickies(model.definitions, anchors);
    return { xml: moved.length ? await serialize(model) : xml, moved };
  }

  /** The ops the diagram phase runs after the layout: format ops and lane orders, with their batch index. */
  private formatEntries(ops: Op[]): FormatEntry[] {
    const out: FormatEntry[] = [];
    ops.forEach((op, index) => {
      if (isFormatOp(op) || (op.op === 'order' && (ordersLanes(this.doc, op) || ordersPools(this.doc, op)))) out.push({ op, index });
    });
    return out;
  }

  /** Runs the format ops on the laid-out XML; returns the new XML and their results. */
  private static async runFormat(xml: string, file: string | undefined, entries: FormatEntry[], asFile: boolean): Promise<{ xml: string; results: FormatResult[]; after: LayoutMetrics }> {
    const laid = await Doc.fromXml(xml, file);
    const results = runFormatOps(laid, entries, asFile);
    return { xml: await laid.toXml(), results, after: layoutProblems(laid.definitions) };
  }

  /**
   * Whether re-running the engine on the model before the ops reproduces its
   * drawing. Flow nodes without a shape (added with --no-layout) are left out
   * of that model first, bridged like `remove` does: a stale but engine-made
   * drawing is still engine-owned.
   */
  private static async isEngineOwned(xml: string, engine: LayoutEngine | undefined, undrawn: readonly string[]): Promise<boolean> {
    const model = await parseXml(xml);
    const mine = diagramGeometry(model.definitions);
    let reference = xml;
    if (undrawn.length) {
      try {
        const reduced = await Doc.fromXml(xml);
        // the bridged flows keep their ids: the drawing is compared edge by edge
        reduced.followFlowEnds = false;
        new OpRunner(reduced).runBatch([{ op: 'remove', ids: [...undrawn], ifExists: true }]);
        reference = await reduced.toXml();
      } catch {
        return false;
      }
    }
    const clean = await parseXml(reference);
    await layoutModel(clean, {});
    if (engineOwned(mine, clean.definitions)) return true;
    if (engine !== 'auto') return false;
    const auto = await parseXml(reference);
    const result = await layoutModel(auto, { engine: 'auto' });
    return engineOwned(mine, (await parseXml(result.xml)).definitions);
  }

  private async decideMode(requested: LayoutMode): Promise<{ mode: 'full' | 'incremental'; reason: string }> {
    const before = this.before;
    if (requested === 'full') return { mode: 'full', reason: 'full redraw requested' };
    if (!before.snapshot.flowNodeShapes) return { mode: 'full', reason: 'no diagram before: drawn from scratch' };
    if (requested === 'incremental') return { mode: 'incremental', reason: 'incremental layout requested' };
    const undrawn = before.snapshot.undrawn;
    const missing = undrawn.length ? `${undrawn.length} flow node(s) had no shape (e.g. added with --no-layout)` : '';
    if (before.xml && (await DiagramUpdate.isEngineOwned(before.xml, this.opts.engine, undrawn))) return { mode: 'full', reason: missing ? `engine-owned diagram (${missing}): redrawn` : 'engine-owned diagram: redrawn' };
    if (missing) return { mode: 'incremental', reason: `diagram kept: ${missing}; they are placed locally like new elements (\`bpmn layout\` redraws everything)` };
    return { mode: 'incremental', reason: 'hand-made diagram: kept, changes placed locally' };
  }

  /**
   * Full redraw with the engine; colours survive by element id (the DI ids
   * survive inside layoutModel, diagram/write.ts restoreDiIds; so do group
   * boxes, drawn again around what they held, diagram/groups.ts).
   */
  private async fullLayout(edit: EditContext): Promise<Ran> {
    const doc = this.doc;
    const colors = colorsOf(doc.definitions);
    const expansion = doc.layoutRequests.expansion(this.opts);
    // an element without id that the redraw draws gets one in the document's style and registry
    const result = await layoutModel(doc.model, { ...expansion, engine: this.opts.engine, allocateId: (req) => edit.allocateId(req).id });
    if (result.givenIds?.length) doc.invalidate();
    let xml = result.xml;
    let defs = doc.definitions;
    if ((this.opts.engine ?? 'clean') !== 'clean') {
      const laidOut = await parseXml(xml);
      defs = laidOut.definitions;
      if (applyColors(laidOut.moddle, defs, colors)) xml = await serialize(laidOut);
    } else if (applyColors(doc.moddle, defs, colors)) {
      xml = await doc.toXml();
    }
    return { xml, status: { status: 'ok', mode: 'full', warnings: result.warnings, expanded: result.expanded, ...(result.notes?.length ? { notes: result.notes } : {}) }, after: layoutProblems(defs), ...(result.givenIds?.length ? { givenIds: result.givenIds } : {}) };
  }

  private async incrementalLayout(relocated: string[], created: readonly string[]): Promise<Ran> {
    const doc = this.doc;
    const expansion = doc.layoutRequests.expansion(this.opts);
    const report: IncrementalReport = await layoutIncremental(doc, this.before.snapshot, { relocated, created, ...expansion });
    const groups = redrawGroups(doc.moddle, doc.definitions, undrawnGroups(doc.definitions), diIds(doc.definitions).shape);
    const xml = await doc.toXml();
    return {
      xml,
      status: {
        status: 'ok',
        mode: 'incremental',
        warnings: [],
        expanded: [],
        placed: [...report.placed, ...groups.drawn],
        moved: report.moved,
        rerouted: report.rerouted,
        ...(report.reshaped.length ? { reshaped: report.reshaped } : {}),
        pruned: report.pruned,
        notes: report.notes,
      },
      after: layoutProblems(doc.definitions),
    };
  }

  /**
   * Lays the document out in the decided mode. In auto mode a failing
   * incremental layout falls back to a full redraw (layout warning
   * INCREMENTAL_FAILED, shown as W_LAYOUT_*); a requested incremental layout
   * that fails is a layout error instead (LAYOUT_INCREMENTAL, shown as E_LAYOUT_*).
   */
  private async runLayout(edit: EditContext, requested: LayoutMode, relocated: string[], created: readonly string[]): Promise<{ xml: string; layout: LayoutStatus; givenIds?: GivenId[] }> {
    const decision = await this.decideMode(requested);
    let ran: Ran;
    if (decision.mode === 'full') ran = await this.fullLayout(edit);
    else {
      try {
        ran = await this.incrementalLayout(relocated, created);
      } catch (err) {
        if (err instanceof CliError) throw err;
        if (requested === 'incremental') {
          throw new ModelError(`Incremental layout failed: ${firstLine(err)}`, 'LAYOUT_INCREMENTAL', {
            hint: 'Retry with --layout full (redraws the whole diagram) or --no-layout (writes without updating the diagram), and report the command and file.',
          });
        }
        ran = await this.fullLayout(edit);
        decision.mode = 'full';
        decision.reason = `incremental layout failed (${firstLine(err)}): redrawn`;
        ran.status.warnings.push({ code: 'INCREMENTAL_FAILED', elementId: '', message: `The incremental layout failed and the diagram was redrawn: ${firstLine(err)}`, relatedElementIds: [] });
      }
    }
    return { xml: ran.xml, layout: { ...ran.status, mode: decision.mode, reason: decision.reason, metrics: metricsDelta(this.before.metrics, ran.after) }, ...(ran.givenIds ? { givenIds: ran.givenIds } : {}) };
  }
}
