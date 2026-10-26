import { utf8Declaration } from '../document/utils/encoding.js';
import { Doc } from '../document/Doc.js';
import { CliError } from '../document/CliError.js';
import { FullLayout, type LayoutEngine } from '../diagram/layout/FullLayout.js';
import { SUB_PROCESS_TYPES } from '../diagram/utils/expansion.js';
import type { GivenId } from '../diagram/di/DrawnElementIds.js';
import { DiagramGeometry } from '../diagram/layout/DiagramGeometry.js';
import { IncrementalLayout, type IncrementalReport } from '../diagram/layout/incremental/IncrementalLayout.js';
import { Snapshot } from '../diagram/layout/incremental/Snapshot.js';
import { LayoutAnalysis } from '../diagram/di/LayoutAnalysis.js';
import { metricsDelta, type LayoutMetrics } from '../diagram/utils/problems.js';
import { DiagramCommandService, type FormatEntry, type FormatResult } from './DiagramCommandService.js';
import { Stickies, type ResolvedAnchor, type StickyAnchor } from '../diagram/di/Stickies.js';
import { applyColors, colorsOf } from '../diagram/utils/colors.js';
import { DiIds } from '../diagram/di/DiIds.js';
import { Groups } from '../diagram/di/Groups.js';
import { serializeWithout, unkeptEntries, withoutEntries } from '../document/utils/mirror.js';
import { addTo, is, layoutRoot, many, parseXml, serialize, type El } from '../document/utils/moddle.js';
import { ModelError } from '../document/ModelError.js';
import type { EditContext } from '../document/EditContext.js';
import type { ChangeSet } from '../document/ChangeSet.js';
import { ModelCommandService } from './ModelCommandService.js';
import { ElementOrderService } from '../editing/ElementOrderService.js';
import { isDiagramCommand } from '../commands/utils/op-names.js';
import type { EditCommand } from '../commands/types.js';
import { TextPreservation } from '../document/xml/TextPreservation.js';
import { firstLine } from '../document/utils/text.js';
import { toCliError } from '../document/utils/cli-error.js';
import type { LayoutMode, LayoutStatus, MutationOptions } from './types.js';

interface Before {
  snapshot: Snapshot;
  stickies: StickyAnchor[];
  /** only for the ownership check of auto mode */
  xml?: string;
  metrics?: LayoutMetrics;
}

/** The commands since the drawing was last brought up to date: index `start` to before `end` of the batch. */
export interface DrawingSegment {
  start: number;
  end: number;
  /** a model command among them: the diagram is laid out before their diagram commands run */
  model: boolean;
  /** the ids their model commands created */
  created: string[];
}

interface Ran {
  xml: string;
  status: LayoutStatus;
  after: LayoutMetrics;
  givenIds?: GivenId[];
}

/**
 * What a write does to the drawing and the text it writes: captured before the ops run,
 * applied after them (layout, format ops, stickies, text preservation). In a batch whose
 * model commands follow diagram commands, drawBetween brings the drawing up to date first.
 */
export class BatchLayoutService {
  /** the layouts and diagram commands drawBetween ran, merged into the result's layout */
  private readonly drawn: LayoutStatus[] = [];

  private constructor(
    private readonly doc: Doc,
    private readonly opts: MutationOptions,
    private requested: LayoutMode | 'skip',
    private readonly formatOnly: boolean,
    private readonly before: Before,
    /** without the entries a caller's validateDoc added in memory */
    private readonly asRead: string | undefined,
  ) {}

  static async capture(doc: Doc, ops: EditCommand[], opts: MutationOptions): Promise<BatchLayoutService> {
    const asRead = doc.source ? await serializeWithout(doc.model, unkeptEntries(doc.definitions, doc.source.mirror)) : undefined;
    const requested = opts.layout === false ? 'skip' : opts.layout === undefined || opts.layout === true ? 'auto' : opts.layout;
    const formatOnly = ops.length > 0 && ops.every(isDiagramCommand);
    const snapshot = Snapshot.take(doc.definitions);
    const hasDiagram = many(doc.definitions, 'diagrams').length > 0 && snapshot.byDi.size > 0;
    const before: Before = { snapshot, stickies: new Stickies(doc.definitions).anchors() };
    if (hasDiagram) before.metrics = LayoutAnalysis.of(doc.definitions);
    if (requested === 'auto' && !formatOnly && snapshot.flowNodeShapes > 0) before.xml = asRead ?? (await doc.toXml());
    return new BatchLayoutService(doc, opts, requested, formatOnly, before, asRead);
  }

  /**
   * Lays out the model commands of `segment` and runs its diagram commands on the document
   * itself; the next layout keeps that drawing like a hand-made one. Between two
   * full redraws the clean engine draws: only its drawing is the document's own.
   */
  async drawBetween(edit: EditContext, ran: EditCommand[], changes: ChangeSet, segment: DrawingSegment): Promise<void> {
    const doc = this.doc;
    let layout: LayoutStatus = { status: this.requested === 'skip' ? 'skipped' : 'ok', warnings: [], expanded: [] };
    const keepsDrawing = this.requested === 'skip' || (!segment.model && this.requested !== 'full' && this.before.snapshot.flowNodeShapes > 0);
    if (!keepsDrawing && this.requested !== 'skip') {
      let givenIds: GivenId[] | undefined;
      try {
        ({ layout, givenIds } = await this.runLayout(edit, this.requested, BatchLayoutService.relocatedIds(ran.slice(segment.start, segment.end), changes), segment.created, 'clean'));
      } catch (err) {
        throw toCliError(err);
      }
      BatchLayoutService.noteGivenIds(changes, givenIds);
    }
    const entries = this.formatEntries(ran).filter((entry) => entry.index >= segment.start && entry.index < segment.end);
    if (entries.length) layout.format = new DiagramCommandService(doc).run(entries);
    this.drawn.push(layout);
    this.before.snapshot = Snapshot.take(doc.definitions);
    this.before.xml = undefined;
    if (this.requested === 'full') this.requested = 'incremental';
  }

  /**
   * The batch cut where a model command follows a diagram command: the diagram commands
   * of a segment see the drawing of every command before them.
   */
  static segmentsOf(ops: readonly EditCommand[]): Array<Omit<DrawingSegment, 'created'>> {
    const segments: Array<Omit<DrawingSegment, 'created'>> = [];
    let start = 0;
    const segment = (end: number) => ({ start, end, model: ops.slice(start, end).some((op) => !isDiagramCommand(op)) });
    ops.forEach((op, index) => {
      if (index === 0 || isDiagramCommand(op) || !isDiagramCommand(ops[index - 1]!)) return;
      segments.push(segment(index));
      start = index;
    });
    segments.push(segment(ops.length));
    return segments;
  }

  /**
   * `ran` holds the ops with their batch aliases resolved; `segment` the commands since
   * drawBetween last ran (the whole batch when it did not).
   */
  async apply(edit: EditContext, ran: EditCommand[], changes: ChangeSet, segment?: DrawingSegment): Promise<{ xml: string; layout: LayoutStatus }> {
    const doc = this.doc;
    const current = segment ?? { start: 0, end: ran.length, model: !this.formatOnly, created: changes.created.map((created) => created.id) };
    let xml: string;
    let layout: LayoutStatus;
    // a format op's refusal may then name a command to run on the file
    let fileDrawing = false;
    if (this.requested === 'skip') {
      const pruned = this.pruneDanglingDi();
      // an edge showing old ends goes too: the next write draws the flow like a new one
      const reEnded = this.before.snapshot.pruneReEnded(doc.definitions);
      if (pruned || reEnded.length) changes.note(BatchLayoutService.staleDiNote(pruned, reEnded));
      this.persistExpansionHints(doc.layoutRequests.expansion(this.opts));
      xml = await doc.toXml();
      layout = { status: 'skipped', warnings: [], expanded: [], metrics: metricsDelta(this.before.metrics, LayoutAnalysis.of(doc.definitions)) };
    } else if (!current.model && this.requested !== 'full' && this.before.snapshot.flowNodeShapes > 0) {
      xml = await doc.toXml();
      fileDrawing = current.start === 0;
      layout = { status: 'ok', mode: 'incremental', reason: 'format operations only: drawing kept', warnings: [], expanded: [] };
    } else {
      let givenIds: GivenId[] | undefined;
      try {
        ({ xml, layout, givenIds } = await this.runLayout(edit, this.requested, BatchLayoutService.relocatedIds(ran.slice(current.start, current.end), changes), current.created));
      } catch (err) {
        throw toCliError(err);
      }
      BatchLayoutService.noteGivenIds(changes, givenIds);
    }

    const entries = this.formatEntries(ran).filter((entry) => entry.index >= current.start && entry.index < current.end);
    if (entries.length) {
      const formatted = await BatchLayoutService.runFormat(xml, doc.file, entries, fileDrawing);
      xml = formatted.xml;
      layout.format = formatted.results;
      layout.metrics = metricsDelta(this.before.metrics, formatted.after);
    }
    const followed = await BatchLayoutService.moveStickies(xml, this.resolveAnchors());
    xml = followed.xml;
    if (followed.moved.length) layout.stickies = followed.moved;

    return { xml: await this.outputText(xml, changes), layout: this.withDrawn(layout) };
  }

  private static noteGivenIds(changes: ChangeSet, givenIds: GivenId[] | undefined): void {
    if (!givenIds?.length) return;
    for (const given of givenIds) changes.change({ id: given.id, kind: given.kind, ...(given.name ? { name: given.name } : {}), detail: 'id added (it had none; the diagram refers to elements by id)' });
    changes.note(`${givenIds.length} element(s) without id got one in the file's id style so that the redrawn diagram can show them: ${givenIds.map((given) => given.id).join(', ')}`);
  }

  /** The last layout with what drawBetween drew before it: the first layout's mode and reason, every id and diagram command. */
  private withDrawn(last: LayoutStatus): LayoutStatus {
    const drawn = [...this.drawn, last];
    if (drawn.length === 1) return last;
    const first = drawn.find((status) => status.mode) ?? last;
    const all = <TKey extends 'placed' | 'moved' | 'rerouted' | 'reshaped' | 'pruned'>(key: TKey): string[] => [...new Set(drawn.flatMap((status) => status[key] ?? []))];
    const format = drawn.flatMap((status) => status.format ?? []);
    const notes = drawn.flatMap((status) => status.notes ?? []);
    const merged: LayoutStatus = {
      ...last,
      ...(first.mode ? { mode: first.mode } : {}),
      ...(first.reason ? { reason: first.reason } : {}),
      warnings: drawn.flatMap((status) => status.warnings),
      expanded: [...new Set(drawn.flatMap((status) => status.expanded))],
      ...(format.length ? { format } : {}),
      ...(notes.length ? { notes } : {}),
    };
    for (const key of ['placed', 'moved', 'rerouted', 'reshaped', 'pruned'] as const) {
      const ids = all(key);
      if (ids.length) merged[key] = ids;
    }
    return merged;
  }

  private static staleDiNote(pruned: number, reEnded: string[]): string {
    const removed = `removed ${pruned + reEnded.length} stale diagram element(s)`;
    const flows = [...new Set(reEnded)];
    if (!flows.length) return `${removed}; run \`bpmn layout <file>\` to redraw`;
    const shown = flows.slice(0, 8).join(', ') + (flows.length > 8 ? ` and ${flows.length - 8} more` : '');
    return `${removed}, among them the edge(s) of ${shown} (their ends changed; the next model edit without --no-layout draws them, or \`bpmn route <file> <flowId>\`)`;
  }

  private pruneDanglingDi(): number {
    const index = this.doc.byId();
    let removed = 0;
    for (const diagram of many(this.doc.definitions, 'diagrams')) {
      const plane = diagram.get<El | undefined>('plane');
      if (!plane) continue;
      const elements = many(plane, 'planeElement');
      for (let elementIndex = elements.length - 1; elementIndex >= 0; elementIndex--) {
        const target = elements[elementIndex]!.get<El | undefined>('bpmnElement');
        const id = target?.get<string | undefined>('id');
        if (!target || !id || index.get(id) !== target) {
          elements.splice(elementIndex, 1);
          removed++;
        }
      }
    }
    return removed;
  }

  /**
   * Without a layout the expansion requests would be lost: only the layouter reads them.
   * Recorded in the DI, the next layout picks them up.
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
    let newDi: DiIds | undefined;
    for (const [id, expanded] of wanted) {
      const sub = doc.get(id);
      if (!sub || !SUB_PROCESS_TYPES.some((type) => is(sub, type))) continue;
      const existing = shapes.get(id);
      if (existing) {
        existing.set('isExpanded', expanded);
        continue;
      }
      if (expanded) continue; // expanded is the default when no shape records anything
      if (!rootPlane) {
        const root = layoutRoot(doc.definitions);
        if (!root) continue;
        newDi ??= new DiIds(doc.definitions);
        rootPlane = doc.moddle.create('bpmndi:BPMNPlane', { id: newDi.plane(root.get<string>('id')), bpmnElement: root });
        const diagram = doc.moddle.create('bpmndi:BPMNDiagram', { id: newDi.diagram(root.get<string>('id')), plane: rootPlane });
        rootPlane.$parent = diagram;
        addTo(doc.definitions, 'diagrams', diagram);
      }
      // a placeholder shape the next layout redraws, so the collapse survives
      const shape = doc.moddle.create('bpmndi:BPMNShape', {
        id: (newDi ??= new DiIds(doc.definitions)).shape(id),
        bpmnElement: sub,
        isExpanded: false,
        bounds: doc.moddle.create('dc:Bounds', { x: 0, y: 0, width: 100, height: 80 }),
      });
      addTo(rootPlane, 'planeElement', shape);
    }
    doc.invalidate();
  }

  /** A node a move left where it was (`move B --after A` with A -> B) keeps its place. */
  private static relocatedIds(ops: EditCommand[], changes: ChangeSet): string[] {
    const moved = new Set(changes.relocated);
    const out: string[] = [];
    for (const op of ops) {
      if (op.op === 'move' && (op.after || op.before || op.flow || op.in)) out.push(...op.ids.filter((id) => moved.has(id)));
    }
    return out;
  }

  /** For a document read from a file, the parts the ops did not change keep their text. */
  private async outputText(xml: string, changes: ChangeSet): Promise<string> {
    const doc = this.doc;
    const source = doc.source;
    if (!source || this.asRead === undefined) return xml;
    const unkept = unkeptEntries(doc.definitions, source.mirror);
    if (unkept.length) xml = await withoutEntries(xml, unkept);
    // a forced lossy import drops what bpmn-moddle could not read; the original text would not
    const preservation = new TextPreservation(source.text, this.asRead, xml);
    const text = doc.lossyImportWarnings.length ? preservation.plain('the import was lossy') : await preservation.result();
    if (text.mode === 'plain') {
      const comments = text.droppedComments ? `; ${text.droppedComments} XML comment(s) dropped` : '';
      changes.note(`the file's formatting was not kept (${text.reason}): written as bpmn-moddle serialises it${comments}`);
    } else if (text.droppedComments) {
      changes.note(`${text.droppedComments} XML comment(s) dropped: they were inside or next to elements the change removed or rewrote`);
    }
    if (text.xml === source.text) return text.xml;
    // a write is UTF-8: the kept declaration must say so
    const declared = utf8Declaration(text.xml);
    if (declared.was !== undefined) changes.note(`the XML declaration named the encoding ${declared.was}; the text is written as UTF-8, so it now says UTF-8`);
    return declared.text;
  }

  private resolveAnchors(): ResolvedAnchor[] {
    const out: ResolvedAnchor[] = [];
    for (const sticky of this.before.stickies) {
      const processId = sticky.process.get<string | undefined>('id');
      const nodeId = sticky.node.get<string | undefined>('id');
      if (!processId || !nodeId || this.doc.get(processId) !== sticky.process || !this.doc.get(nodeId)) continue;
      out.push({ processId, index: sticky.index, ...(sticky.stickyId !== undefined ? { stickyId: sticky.stickyId } : {}), nodeId, centre: sticky.centre });
    }
    return out;
  }

  private static async moveStickies(xml: string, anchors: ResolvedAnchor[]): Promise<{ xml: string; moved: Array<{ sticky: string; node: string }> }> {
    if (!anchors.length) return { xml, moved: [] };
    const model = await parseXml(xml);
    const moved = new Stickies(model.definitions).follow(anchors);
    return { xml: moved.length ? await serialize(model) : xml, moved };
  }

  /** Diagram commands and lane orders run on the laid-out drawing. */
  private formatEntries(ops: EditCommand[]): FormatEntry[] {
    const out: FormatEntry[] = [];
    ops.forEach((op, index) => {
      if (isDiagramCommand(op) || (op.op === 'order' && new ElementOrderService(this.doc, op).ordersBands())) out.push({ op, index });
    });
    return out;
  }

  private static async runFormat(xml: string, file: string | undefined, entries: FormatEntry[], asFile: boolean): Promise<{ xml: string; results: FormatResult[]; after: LayoutMetrics }> {
    const laid = await Doc.fromXml(xml, file);
    const results = new DiagramCommandService(laid).run(entries, asFile);
    return { xml: await laid.toXml(), results, after: LayoutAnalysis.of(laid.definitions) };
  }

  /**
   * Whether re-running the engine reproduces the drawing. Undrawn flow nodes are removed
   * first: a stale but engine-made drawing is still engine-owned.
   */
  private static async isEngineOwned(xml: string, engine: LayoutEngine | undefined, undrawn: readonly string[]): Promise<boolean> {
    const model = await parseXml(xml);
    const mine = DiagramGeometry.of(model.definitions);
    let reference = xml;
    if (undrawn.length) {
      try {
        const reduced = await Doc.fromXml(xml);
        // the bridged flows keep their ids: the drawing is compared edge by edge
        reduced.followFlowEnds = false;
        new ModelCommandService(reduced).runBatch([{ op: 'remove', ids: [...undrawn], ifExists: true }]);
        reference = await reduced.toXml();
      } catch {
        return false;
      }
    }
    const clean = await parseXml(reference);
    await new FullLayout(clean, {}).run();
    if (mine.drawnBy(clean.definitions)) return true;
    if (engine !== 'auto') return false;
    const auto = await parseXml(reference);
    const result = await new FullLayout(auto, { engine: 'auto' }).run();
    return mine.drawnBy((await parseXml(result.xml)).definitions);
  }

  private async decideMode(requested: LayoutMode): Promise<{ mode: 'full' | 'incremental'; reason: string }> {
    const before = this.before;
    if (requested === 'full') return { mode: 'full', reason: 'full redraw requested' };
    if (!before.snapshot.flowNodeShapes) return { mode: 'full', reason: 'no diagram before: drawn from scratch' };
    if (requested === 'incremental') return { mode: 'incremental', reason: 'incremental layout requested' };
    const undrawn = before.snapshot.undrawn;
    const missing = undrawn.length ? `${undrawn.length} flow node(s) had no shape (e.g. added with --no-layout)` : '';
    if (before.xml && (await BatchLayoutService.isEngineOwned(before.xml, this.opts.engine, undrawn))) return { mode: 'full', reason: missing ? `engine-owned diagram (${missing}): redrawn` : 'engine-owned diagram: redrawn' };
    if (missing) return { mode: 'incremental', reason: `diagram kept: ${missing}; they are placed locally like new elements (\`bpmn layout\` redraws everything)` };
    return { mode: 'incremental', reason: 'hand-made diagram: kept, changes placed locally' };
  }

  /** Colours survive the redraw by element id. */
  private async fullLayout(edit: EditContext, engine = this.opts.engine): Promise<Ran> {
    const doc = this.doc;
    const colors = colorsOf(doc.definitions);
    const expansion = doc.layoutRequests.expansion(this.opts);
    const result = await new FullLayout(doc.model, { ...expansion, engine, allocateId: (req) => edit.allocator.allocate(req).id }).run();
    if (result.givenIds?.length) doc.invalidate();
    let xml = result.xml;
    let defs = doc.definitions;
    if ((engine ?? 'clean') !== 'clean') {
      const laidOut = await parseXml(xml);
      defs = laidOut.definitions;
      if (applyColors(laidOut.moddle, defs, colors)) xml = await serialize(laidOut);
    } else if (applyColors(doc.moddle, defs, colors)) {
      xml = await doc.toXml();
    }
    return { xml, status: { status: 'ok', mode: 'full', warnings: result.warnings, expanded: result.expanded, ...(result.notes?.length ? { notes: result.notes } : {}) }, after: LayoutAnalysis.of(defs), ...(result.givenIds?.length ? { givenIds: result.givenIds } : {}) };
  }

  private async incrementalLayout(relocated: string[], created: readonly string[]): Promise<Ran> {
    const doc = this.doc;
    const expansion = doc.layoutRequests.expansion(this.opts);
    const report: IncrementalReport = await IncrementalLayout.run(doc, this.before.snapshot, { relocated, created, ...expansion });
    const groups = new Groups(doc.definitions).redraw(doc.moddle, new Groups(doc.definitions).undrawn(), new DiIds(doc.definitions).shape);
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
      after: LayoutAnalysis.of(doc.definitions),
    };
  }

  /** In auto mode a failing incremental layout falls back to a full redraw; requested, it fails. */
  private async runLayout(edit: EditContext, requested: LayoutMode, relocated: string[], created: readonly string[], engine = this.opts.engine): Promise<{ xml: string; layout: LayoutStatus; givenIds?: GivenId[] }> {
    const decision = await this.decideMode(requested);
    let ran: Ran;
    if (decision.mode === 'full') ran = await this.fullLayout(edit, engine);
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
        ran = await this.fullLayout(edit, engine);
        decision.mode = 'full';
        decision.reason = `incremental layout failed (${firstLine(err)}): redrawn`;
        ran.status.warnings.push({ code: 'INCREMENTAL_FAILED', elementId: '', message: `The incremental layout failed and the diagram was redrawn: ${firstLine(err)}`, relatedElementIds: [] });
      }
    }
    return { xml: ran.xml, layout: { ...ran.status, mode: decision.mode, reason: decision.reason, metrics: metricsDelta(this.before.metrics, ran.after) }, ...(ran.givenIds ? { givenIds: ran.givenIds } : {}) };
  }
}
