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
 * the file keeps them (mirror.ts; in memory they are complete), and for a
 * document read from XML every element the ops did not change keeps its
 * original text (preserve.ts: prolog, comments, CDATA, attribute order,
 * namespace declarations, indentation); changed and new elements follow the
 * file's style. A write is UTF-8: a changed result whose XML declaration
 * names another encoding declares UTF-8 (src/encoding.ts, with a note). Comments the result cannot keep, and a fall-back to
 * bpmn-moddle's plain serialisation, are reported as notes. A result equal
 * to the input text is `unchanged: true`; the node layer does not write it
 * back over its file (`written: false`; `--out` to another file still writes
 * the copy).
 *
 * This module is the in-memory part (everything but load and write): it
 * never touches the file system or the environment, so it runs in the
 * browser too. src/node/files.ts reads the file, calls mutateDoc and writes
 * the result atomically (mutateFile, the CLI); src/api.ts wraps it for
 * strings (applyToXml).
 *
 * Guards (each overridden by MutationOptions.force / --force):
 *  - lossy import: a document bpmn-moddle dropped content from is refused
 *    with E_IMPORT_LOSSY, by loadDoc and again by mutateDoc, so the library
 *    path (Doc.fromXml + mutateDoc, XML from anywhere) is guarded like files.
 *  - dropped content: a retype whose new kind cannot hold the element's
 *    content (sub-process -> task) is refused with E_WOULD_DROP_CONTENT
 *    listing the ids it would delete (see takeDroppedContent in ops/retype.ts).
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
 *    (retype's W_PROPERTY_INAPPLICABLE, ops/retype.ts withoutProfileDuplicates).
 *  - validators (src/validators.ts; MutationOptions.validators and the
 *    validation profile, MutationOptions.profile: the design profile runs for
 *    the models of a design-iq content repository, MutationOptions.contentRepo,
 *    or on request): each runs on the document before the ops and on the
 *    candidate XML after the layout, the format ops and the text-preserving
 *    step, i.e. on exactly what would be written. Errors the
 *    change introduced block the write (E_VALIDATION, each finding names its
 *    validator); errors the document already had are W_PREEXISTING_ERROR
 *    warnings; introduced warnings are reported (`validation.validators`).
 *
 * Layout modes (MutationOptions.layout):
 *  - false: skip; the DI of removed elements is pruned, new elements have none
 *  - 'full': redraw everything with the engine (clean or auto); bpmn-js
 *    colours (bioc:/color:) and the drawing's DI ids are carried over by
 *    element id (layoutModel, diagram/write.ts restoreDiIds; plane and
 *    diagram ids by root; new DI gets the file's DI id style). An element
 *    the redraw draws that has no id (a hand-written message flow, pool,
 *    process, collaboration) first gets one in the file's id style and
 *    registry (diagram/drawn-ids.ts), reported as a change and a note
 *  - 'incremental': keep every existing shape and connection, place what is
 *    new, prune what is gone, reroute only affected connections
 *    (src/diagram/incremental.ts); a file without any diagram is drawn in full
 *  - 'auto' (default, also `true`): full when the layout root had no flow node
 *    DI before the ops, or when the drawing is engine-owned (re-running the
 *    clean engine on the model as it was before the ops reproduces every
 *    shape, label and connection within 2 px; flow nodes without a shape, e.g.
 *    added with --no-layout, are removed from that model first, bridged like
 *    `remove`; with --engine auto also that engine); otherwise incremental.
 *    If the incremental layout fails, auto falls back to full.
 * The result reports the mode, why it ran, what the incremental engine
 * placed / moved / rerouted / pruned, and the layout problems before / after
 * (src/diagram/metrics.ts) with the problems added and resolved.
 *
 * Format ops (place, align, color, label, route, space, tidy, and the lane
 * part of `order`; src/diagram/ops.ts) run after the layout, on its result,
 * in batch order; a failing one fails the whole batch. A batch of format ops
 * only keeps the drawing (no layout runs) unless `full` is requested or the
 * file has no diagram yet; with --no-layout they run on the existing DI.
 * Their results are reported in `layout.format`, and `layout.metrics`
 * measures after them. A format op that changes the geometry (also a route
 * or a label side) makes the drawing hand-made, so later `auto` writes keep
 * it; colours survive full redraws.
 *
 * design-iq stickies (`bpmiq:sticky` extension elements with absolute
 * coordinates, src/diagram/stickies.ts) follow the flow node nearest to them
 * before the ops by the shift of its centre, after the layout and the format
 * ops, whatever moved it (incremental placement, a format op, a redraw); a
 * write that moves no node leaves them untouched. `layout.stickies` lists
 * the stickies that moved.
 */
import { withLayoutDebug, type DebugSink } from './debug.js';
import { utf8Declaration } from './encoding.js';
import { Doc } from './document.js';
import { CliError, ioError, modelError, usageError, type Warning } from './errors.js';
import { layoutModel, SUB_PROCESS_TYPES, type LayoutWarningInfo, type LayoutEngine } from './layout.js';
import type { GivenId } from './diagram/drawn-ids.js';
import { diagramGeometry, engineOwned, layoutIncremental, takeSnapshot, type IncrementalReport, type Snapshot } from './diagram/incremental.js';
import { layoutProblems, metricsDelta, type LayoutMetrics, type MetricsDelta } from './diagram/metrics.js';
import { runFormatOps, type FormatEntry, type FormatResult } from './diagram/ops.js';
import { followStickies, stickyAnchors, type ResolvedAnchor, type StickyAnchor } from './diagram/stickies.js';
import { applyColors, colorsOf, diIds } from './diagram/write.js';
import { kindLabel } from './kinds.js';
import { serializeWithout, unkeptEntries, withoutEntries } from './mirror.js';
import { addTo, is, layoutRoot, many, ModelError, parseXml, serialize, type El } from './model.js';
import { collapsedIds } from './ops/add.js';
import { reportedImportWarnings } from './ops/decision.js';
import { runBatch, runOps } from './ops/index.js';
import { ordersLanes } from './ops/order.js';
import { takeDroppedContent, withoutProfileDuplicates, type DroppedContent } from './ops/retype.js';
import { requestedExpansion } from './ops/set.js';
import { isFormatOp, type Op } from './ops/types.js';
import { ChangeSet } from './result.js';
import { resolvePlatform } from './platform/detect.js';
import { profileBaseline, type PlatformChoice, type ProfileBaseline } from './platform/profile.js';
import { plainText, preserveText } from './preserve.js';
import { profileValidators, resolveProfile, type ContentRepo, type ProfileChoice, type ProfileInfo } from './platform/repo.js';
import { validateDoc, withProfileChanges, type ValidationResult } from './validate.js';
import { checkReports, compareRuns, namedValidators, once, renamesOf, runValidators, validatorRefusal, withValidatorReports, type NamedValidator, type Validator, type ValidatorContext, type ValidatorRun } from './validators.js';
import { buildView, type ModelView } from './view.js';

/**
 * Options of the in-memory pipeline. Writing (out, dryRun, backup,
 * mustNotExist) is the node layer's: FileMutationOptions in src/node/files.ts.
 */
export interface MutationOptions {
  /**
   * diagram handling: false = skip (stale DI), true / 'auto' (default) = keep a
   * hand-made drawing and redraw an engine-owned one, 'incremental', 'full'
   */
  layout?: boolean | LayoutMode;
  /** write despite lossy import / validation errors */
  force?: boolean;
  /** include the model view in the result */
  show?: boolean;
  /** additional sub-process ids to expand / collapse (layout command) */
  expand?: string[];
  collapse?: string[];
  /** layout engine: 'clean' (default) or 'auto' (bpmn-auto-layout) */
  engine?: LayoutEngine;
  /** platform profile whose new findings are reported: 'auto' (default) detects it, 'none' switches it off */
  platform?: PlatformChoice;
  /** receives the layout engines' diagnostic lines during this call (src/debug.ts; the CLI: BPMN_LAYOUT_DEBUG) */
  debug?: DebugSink;
  /**
   * validation profile: 'auto' (default) runs the design profile (the design-iq
   * save gate, platform/design.ts) when the document is a model of a design-iq
   * content repository (`contentRepo`), 'design' always, 'none' never
   */
  profile?: ProfileChoice;
  /**
   * the design-iq content repository the document is a model of (auto
   * profile; with model ids also the call / decision link checks). The node
   * layer finds it for a file (bpmiq.yml, src/node/repo.ts); a host passes it.
   */
  contentRepo?: ContentRepo;
  /** validators run on the candidate XML inside the transaction (src/validators.ts); errors they find in the change block the write */
  validators?: Validator[];
  /** the file being written, for the validators (`ctx.file`) and the design profile's own process id; default doc.file (the node layer passes its target) */
  file?: string;
}

export type LayoutMode = 'auto' | 'incremental' | 'full';

export const LAYOUT_MODES: readonly LayoutMode[] = ['auto', 'incremental', 'full'];

export interface LayoutStatus {
  status: 'ok' | 'skipped';
  /** the layout that ran (status ok) */
  mode?: 'full' | 'incremental';
  /** why that mode ran */
  reason?: string;
  warnings: LayoutWarningInfo[];
  expanded: string[];
  /** incremental: elements that got new DI */
  placed?: string[];
  /** incremental: pre-existing shapes whose bounds changed */
  moved?: string[];
  /** incremental: pre-existing connections that were routed again */
  rerouted?: string[];
  /** DI of removed elements that was deleted */
  pruned?: string[];
  notes?: string[];
  /** layout problems before (when a diagram existed) / after, and the difference */
  metrics?: MetricsDelta;
  /** what each format op (and lane order) of the batch did to the drawing, in batch order */
  format?: FormatResult[];
  /** design-iq stickies moved along with their flow node (sticky id, or `<processId>#<n>` without id) */
  stickies?: Array<{ sticky: string; node: string }>;
}

export interface MutationResult {
  ok: true;
  /** the document's file name (Doc.file), or the file written to (node layer) */
  file?: string;
  /** whether the node layer wrote the file; always false from the in-memory pipeline (mutateDoc). The node layer does not write a result that is `unchanged` over its own file */
  written: boolean;
  /** the result is the input text byte for byte (the ops changed nothing that is written) */
  unchanged: boolean;
  changes: ChangeSet;
  /** batch aliases (`"as": "$name"`, ops/aliases.ts) -> the final id of their element; absent without aliases */
  aliases?: Record<string, string>;
  layout: LayoutStatus;
  validation: ValidationResult;
  /** import warnings of the loaded file (informational) */
  importWarnings: string[];
  view?: ModelView;
  xml: string;
}

/** Throws E_IMPORT_LOSSY when bpmn-moddle dropped content while importing the document (unless force). */
export function assertLossless(doc: Doc, opts: { force?: boolean } = {}): void {
  const lossy = doc.lossyImportWarnings;
  if (!lossy.length || opts.force) return;
  throw ioError('E_IMPORT_LOSSY', `${doc.file ?? 'The XML'} contains content bpmn-moddle cannot represent; writing it back would lose data`, {
    ...(doc.file ? { file: doc.file } : {}),
    warnings: lossy.map((w) => w.message.split('\n')[0]),
    hint: 'Fix the XML, or pass --force (MutationOptions.force) to write anyway (the reported content will be dropped).',
  });
}

/** Refuses content that retypes deleted (the agent asked for another kind, not for a deletion). */
function refuseDroppedContent(drops: DroppedContent[]): void {
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

/** The validation errors of a document before the ops, with the elements they named. */
export interface ErrorBaseline {
  errors: Warning[];
  /** id -> element before the ops (an element renamed or retyped by the ops is still recognised) */
  index: Map<string, El>;
  /** the platform profile before the ops (its findings are not repeated by the mutation) */
  profile?: ProfileBaseline;
}

/** Validates the document before the ops run (this also repairs missing incoming/outgoing entries, see repairFlowLinks). */
export function errorBaseline(doc: Doc, platform: PlatformChoice = 'auto'): ErrorBaseline {
  return { errors: validateDoc(doc).errors, index: new Map(doc.byId()), profile: profileBaseline(doc, platform) };
}

/** Whether `after` is the finding `before` again: same code, about the same element (by id, or by identity after a rename). */
function sameFinding(doc: Doc, baseline: ErrorBaseline, before: Warning, after: Warning): boolean {
  if (before.code !== after.code) return false;
  if (before.element === after.element) return true;
  const was = before.element ? baseline.index.get(before.element) : undefined;
  return !!was && !!after.element && doc.get(after.element) === was;
}

/**
 * Splits the errors after the ops into the ones the ops introduced and the
 * ones the document already had (matched once each, see sameFinding); the
 * latter become W_PREEXISTING_ERROR warnings that keep element and hint.
 */
export function separatePreexisting(doc: Doc, after: ValidationResult, baseline: ErrorBaseline): ValidationResult {
  const left = [...baseline.errors];
  const errors: Warning[] = [];
  const preexisting: Warning[] = [];
  for (const f of after.errors) {
    const i = left.findIndex((b) => sameFinding(doc, baseline, b, f));
    if (i === -1) {
      errors.push(f);
      continue;
    }
    left.splice(i, 1);
    preexisting.push({ ...f, code: 'W_PREEXISTING_ERROR', message: `${f.code}: ${f.message} (already in the model before this change)` });
  }
  return { errors, warnings: [...preexisting, ...after.warnings] };
}

/** Removes DI shapes/edges whose semantic element no longer exists (used with --no-layout). */
export function pruneDanglingDi(doc: Doc): number {
  const index = doc.byId();
  let removed = 0;
  for (const diagram of many(doc.definitions, 'diagrams')) {
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

function collectExpansion(doc: Doc, opts: MutationOptions): { expand: string[]; collapse: string[] } {
  const expand = new Set<string>(opts.expand ?? []);
  const collapse = new Set<string>(opts.collapse ?? []);
  for (const id of collapsedIds(doc)) collapse.add(id);
  const requested = requestedExpansion(doc);
  for (const id of requested.expand) expand.add(id);
  for (const id of requested.collapse) collapse.add(id);
  // explicit expand wins over stale collapse requests and vice versa (last writer: options)
  for (const id of opts.expand ?? []) collapse.delete(id);
  for (const id of opts.collapse ?? []) expand.delete(id);
  return { expand: [...expand], collapse: [...collapse] };
}

/**
 * With --no-layout the expansion requests (`set expanded=`, `add --collapsed`,
 * `layout --collapse/--expand`) would otherwise be lost: they live in
 * per-document registries that only the layouter reads. Record them in the
 * existing DI so the next layout picks them up (see diExpansionState).
 */
export function persistExpansionHints(doc: Doc, expansion: { expand: string[]; collapse: string[] }): void {
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
      rootPlane = doc.moddle.create('bpmndi:BPMNPlane', { id: `BPMNPlane_${root.get<string>('id')}`, bpmnElement: root });
      const diagram = doc.moddle.create('bpmndi:BPMNDiagram', { id: `BPMNDiagram_${root.get<string>('id')}`, plane: rootPlane });
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

function toCliError(err: unknown): unknown {
  if (err instanceof ModelError) {
    const category = err.code.startsWith('LAYOUT') ? 'layout' : err.code === 'PARSE_ERROR' ? 'io' : 'model';
    return new CliError(err.code.startsWith('LAYOUT') ? `E_${err.code}` : `E_${err.code}`, err.message, category, err.details);
  }
  return err;
}

/** The normalised layout request. */
function requestedMode(layout: MutationOptions['layout']): LayoutMode | 'skip' {
  if (layout === false) return 'skip';
  if (layout === undefined || layout === true) return 'auto';
  return layout;
}

/** Nodes the ops re-insert elsewhere (move with a placement): the incremental engine places them again. */
function relocatedIds(ops: Op[]): string[] {
  const out: string[] = [];
  for (const op of ops) {
    if (op.op === 'move' && (op.after || op.before || op.flow || op.in)) out.push(...op.ids);
  }
  return out;
}

interface Before {
  snapshot: Snapshot;
  /** the node each design-iq sticky follows */
  stickies: StickyAnchor[];
  /** the model before the ops (only for the ownership check of auto mode) */
  xml?: string;
  metrics?: LayoutMetrics;
}

async function captureBefore(doc: Doc, mode: LayoutMode | 'skip', formatOnly: boolean, baseline: string | undefined): Promise<Before> {
  const snapshot = takeSnapshot(doc.definitions);
  const hasDiagram = many(doc.definitions, 'diagrams').length > 0 && snapshot.byDi.size > 0;
  const before: Before = { snapshot, stickies: stickyAnchors(doc.definitions) };
  if (hasDiagram) before.metrics = layoutProblems(doc.definitions);
  if (mode === 'auto' && !formatOnly && snapshot.flowNodeShapes > 0) before.xml = baseline ?? (await doc.toXml());
  return before;
}

/**
 * The text a mutation writes. The mirror entries the file does not keep are
 * left out (mirror.ts). For a document read from a file, the parts the ops
 * did not change keep their original text (preserve.ts; `baseline` is the
 * serialisation of the document as read); comments that could not be kept
 * and a fall-back to the plain serialisation are reported as notes.
 */
async function outputText(doc: Doc, xml: string, baseline: string | undefined, changes: ChangeSet): Promise<string> {
  const source = doc.source;
  if (!source || baseline === undefined) return xml;
  const unkept = unkeptEntries(doc.definitions, source.mirror);
  if (unkept.length) xml = await withoutEntries(xml, unkept);
  // a forced write of a lossy import drops what bpmn-moddle could not read: the original text would keep it
  const text = doc.lossyImportWarnings.length ? plainText(source.text, xml, 'the import was lossy') : await preserveText(source.text, baseline, xml);
  if (text.mode === 'plain') {
    const comments = text.droppedComments ? `; ${text.droppedComments} XML comment(s) dropped` : '';
    changes.note(`the file's formatting was not kept (${text.reason}): written as bpmn-moddle serialises it${comments}`);
  } else if (text.droppedComments) {
    changes.note(`${text.droppedComments} XML comment(s) dropped: they were inside or next to elements the change removed or rewrote`);
  }
  if (text.xml === source.text) return text.xml;
  // a write is UTF-8 (src/encoding.ts): the kept declaration must say so
  const declared = utf8Declaration(text.xml);
  if (declared.was !== undefined) changes.note(`the XML declaration named the encoding ${declared.was}; the text is written as UTF-8, so it now says UTF-8`);
  return declared.text;
}

/** The anchors of the stickies with the ids their process and node have after the ops (removed ones are left out). */
function resolveAnchors(doc: Doc, anchors: readonly StickyAnchor[]): ResolvedAnchor[] {
  const out: ResolvedAnchor[] = [];
  for (const a of anchors) {
    const processId = a.process.get<string | undefined>('id');
    const nodeId = a.node.get<string | undefined>('id');
    if (!processId || !nodeId || doc.get(processId) !== a.process || !doc.get(nodeId)) continue;
    out.push({ processId, index: a.index, ...(a.stickyId !== undefined ? { stickyId: a.stickyId } : {}), nodeId, centre: a.centre });
  }
  return out;
}

/** Moves the stickies of the written XML with their nodes; returns the new XML and what moved. */
async function moveStickies(xml: string, anchors: ResolvedAnchor[]): Promise<{ xml: string; moved: Array<{ sticky: string; node: string }> }> {
  if (!anchors.length) return { xml, moved: [] };
  const model = await parseXml(xml);
  const moved = followStickies(model.definitions, anchors);
  return { xml: moved.length ? await serialize(model) : xml, moved };
}

/** The ops the diagram phase runs after the layout: format ops and lane orders, with their batch index. */
function formatEntries(doc: Doc, ops: Op[]): FormatEntry[] {
  const out: FormatEntry[] = [];
  ops.forEach((op, index) => {
    if (isFormatOp(op) || (op.op === 'order' && ordersLanes(doc, op))) out.push({ op, index });
  });
  return out;
}

/** Runs the format ops on the laid-out XML; returns the new XML and their results. */
async function runFormat(xml: string, file: string | undefined, entries: FormatEntry[]): Promise<{ xml: string; results: FormatResult[]; after: LayoutMetrics }> {
  const laid = await Doc.fromXml(xml, file);
  const results = runFormatOps(laid, entries);
  return { xml: await laid.toXml(), results, after: layoutProblems(laid.definitions) };
}

/**
 * Whether re-running the engine on the model before the ops reproduces its
 * drawing. Flow nodes without a shape (added with --no-layout) are left out
 * of that model first, bridged like `remove` does: a stale but engine-made
 * drawing is still engine-owned.
 */
async function isEngineOwned(xml: string, engine: LayoutEngine | undefined, undrawn: readonly string[]): Promise<boolean> {
  const model = await parseXml(xml);
  const mine = diagramGeometry(model.definitions);
  let reference = xml;
  if (undrawn.length) {
    try {
      const reduced = await Doc.fromXml(xml);
      // the bridged flows keep their ids: the drawing is compared edge by edge
      reduced.followFlowEnds = false;
      runOps(reduced, [{ op: 'remove', ids: [...undrawn], ifExists: true }]);
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

async function decideMode(requested: LayoutMode, before: Before, opts: MutationOptions): Promise<{ mode: 'full' | 'incremental'; reason: string }> {
  if (requested === 'full') return { mode: 'full', reason: 'full redraw requested' };
  if (!before.snapshot.flowNodeShapes) return { mode: 'full', reason: 'no diagram before: drawn from scratch' };
  if (requested === 'incremental') return { mode: 'incremental', reason: 'incremental layout requested' };
  const undrawn = before.snapshot.undrawn;
  const missing = undrawn.length ? `${undrawn.length} flow node(s) had no shape (e.g. added with --no-layout)` : '';
  if (before.xml && (await isEngineOwned(before.xml, opts.engine, undrawn))) return { mode: 'full', reason: missing ? `engine-owned diagram (${missing}): redrawn` : 'engine-owned diagram: redrawn' };
  if (missing) return { mode: 'incremental', reason: `diagram kept: ${missing}; they are placed locally like new elements (\`bpmn layout\` redraws everything)` };
  return { mode: 'incremental', reason: 'hand-made diagram: kept, changes placed locally' };
}

/**
 * Full redraw with the engine; colours survive by element id (the DI ids
 * survive inside layoutModel, diagram/write.ts restoreDiIds).
 */
async function fullLayout(doc: Doc, opts: MutationOptions): Promise<{ xml: string; status: LayoutStatus; after: LayoutMetrics; givenIds?: GivenId[] }> {
  const colors = colorsOf(doc.definitions);
  const expansion = collectExpansion(doc, opts);
  // an element without id that the redraw draws gets one in the document's style and registry
  const result = await layoutModel(doc.model, { ...expansion, engine: opts.engine, allocateId: (req) => doc.allocateId(req).id });
  if (result.givenIds?.length) doc.invalidate();
  let xml = result.xml;
  let defs = doc.definitions;
  if ((opts.engine ?? 'clean') !== 'clean') {
    const laidOut = await parseXml(xml);
    defs = laidOut.definitions;
    if (applyColors(laidOut.moddle, defs, colors)) xml = await serialize(laidOut);
  } else if (applyColors(doc.moddle, defs, colors)) {
    xml = await doc.toXml();
  }
  return { xml, status: { status: 'ok', mode: 'full', warnings: result.warnings, expanded: result.expanded }, after: layoutProblems(defs), ...(result.givenIds?.length ? { givenIds: result.givenIds } : {}) };
}

async function incrementalLayout(doc: Doc, before: Before, ops: Op[], opts: MutationOptions): Promise<{ xml: string; status: LayoutStatus; after: LayoutMetrics }> {
  const expansion = collectExpansion(doc, opts);
  const report: IncrementalReport = await layoutIncremental(doc, before.snapshot, { relocated: relocatedIds(ops), ...expansion });
  const xml = await doc.toXml();
  return {
    xml,
    status: {
      status: 'ok',
      mode: 'incremental',
      warnings: [],
      expanded: [],
      placed: report.placed,
      moved: report.moved,
      rerouted: report.rerouted,
      pruned: report.pruned,
      notes: report.notes,
    },
    after: layoutProblems(doc.definitions),
  };
}

/** The first line of an error message. */
function firstLine(err: unknown): string {
  return String((err as Error).message ?? err).split('\n')[0]!;
}

/**
 * Lays the document out in the decided mode. In auto mode a failing
 * incremental layout falls back to a full redraw (layout warning
 * INCREMENTAL_FAILED, shown as W_LAYOUT_*); a requested incremental layout
 * that fails is a layout error instead (LAYOUT_INCREMENTAL, shown as E_LAYOUT_*).
 */
async function runLayout(doc: Doc, requested: LayoutMode, before: Before, ops: Op[], opts: MutationOptions): Promise<{ xml: string; layout: LayoutStatus; givenIds?: GivenId[] }> {
  const decision = await decideMode(requested, before, opts);
  let ran: { xml: string; status: LayoutStatus; after: LayoutMetrics; givenIds?: GivenId[] };
  if (decision.mode === 'full') ran = await fullLayout(doc, opts);
  else {
    try {
      ran = await incrementalLayout(doc, before, ops, opts);
    } catch (err) {
      if (err instanceof CliError) throw err;
      if (requested === 'incremental') {
        throw new ModelError(`Incremental layout failed: ${firstLine(err)}`, 'LAYOUT_INCREMENTAL', {
          hint: 'Retry with --layout full (redraws the whole diagram) or --no-layout (writes without updating the diagram), and report the command and file.',
        });
      }
      ran = await fullLayout(doc, opts);
      decision.mode = 'full';
      decision.reason = `incremental layout failed (${firstLine(err)}): redrawn`;
      ran.status.warnings.push({ code: 'INCREMENTAL_FAILED', elementId: '', message: `The incremental layout failed and the diagram was redrawn: ${firstLine(err)}`, relatedElementIds: [] });
    }
  }
  return { xml: ran.xml, layout: { ...ran.status, mode: decision.mode, reason: decision.reason, metrics: metricsDelta(before.metrics, ran.after) }, ...(ran.givenIds ? { givenIds: ran.givenIds } : {}) };
}

/**
 * Applies ops to an in-memory document: the whole pipeline except reading and
 * writing (src/node/files.ts mutateFile / mutateDocToFile write the result).
 * Returns the new XML and what changed; `written` is false. Throws a CliError
 * (E_IMPORT_LOSSY, E_VALIDATION, E_WOULD_DROP_CONTENT, the ops' own codes)
 * and leaves nothing half done: the caller keeps its input when it throws.
 */
export async function mutateDoc(doc: Doc, ops: Op[], opts: MutationOptions = {}): Promise<MutationResult> {
  return withLayoutDebug(opts.debug, () => mutate(doc, ops, opts));
}

async function mutate(doc: Doc, ops: Op[], opts: MutationOptions): Promise<MutationResult> {
  assertLossless(doc, opts);
  // the document as read (entries a caller's validateDoc added in memory left out): unchanged parts keep their text
  const asRead = doc.source ? await serializeWithout(doc.model, unkeptEntries(doc.definitions, doc.source.mirror)) : undefined;
  const requested = requestedMode(opts.layout);
  const formatOnly = ops.length > 0 && ops.every(isFormatOp);
  const before = await captureBefore(doc, requested, formatOnly, asRead);
  const baseline = errorBaseline(doc, opts.platform);
  const importWarnings = reportedImportWarnings(doc).map((w) => w.message.split('\n')[0]!);
  const file = opts.file ?? doc.file;
  const validators = [...profileValidators(resolveProfile(opts.profile ?? 'auto', opts.contentRepo), file), ...namedValidators(opts.validators)];
  const vctx: Omit<ValidatorContext, 'doc' | 'phase'> = { ...(file ? { file } : {}), platform: validators.length ? resolvePlatform(doc, opts.platform ?? 'auto').platform : 'none', ops };
  // the validators' baseline: the document before the ops (its text as read; the in-memory model serialised only for a created document)
  const validatorsBefore: ValidatorRun[] = validators.length
    ? await runValidators(validators, { xml: once(async () => doc.source?.text ?? (await doc.toXml())), doc: async () => doc }, { ...vctx, phase: 'before' })
    : [];
  takeDroppedContent(doc);

  let changes: ChangeSet;
  // the ops with their batch aliases resolved (ops/aliases.ts): what the layout and the format phase run
  let ran: Op[] = ops;
  let aliases: Record<string, string> = {};
  // an explicit platform decides the engine rules of the ops too (event-gateway bridges, defaults of new processes)
  doc.platformChoice = opts.platform && opts.platform !== 'auto' ? opts.platform : undefined;
  try {
    ({ changes, ops: ran, aliases } = runBatch(doc, ops));
  } catch (err) {
    throw toCliError(err);
  } finally {
    doc.platformChoice = undefined;
  }
  if (!opts.force) refuseDroppedContent(takeDroppedContent(doc));

  const structural = separatePreexisting(doc, validateDoc(doc), baseline);
  let validation = baseline.profile ? withProfileChanges(doc, structural, baseline.profile, opts.platform) : structural;
  // an op warning the added platform findings repeat item by item (retype: W_PROPERTY_INAPPLICABLE) is reported once
  changes.warnings = withoutProfileDuplicates(changes.warnings, validation.warnings);
  if (validation.errors.length && !opts.force) {
    throw modelError('E_VALIDATION', `The change would introduce ${validation.errors.length} structural error(s); nothing was written`, {
      errors: validation.errors,
      hint: 'Fix the listed problems, or pass --force to write anyway. `bpmn validate <file>` shows all findings.',
    });
  }

  let xml: string;
  let layout: LayoutStatus;
  if (requested === 'skip') {
    const pruned = pruneDanglingDi(doc);
    if (pruned) changes.note(`removed ${pruned} stale diagram element(s); run \`bpmn layout\` to redraw`);
    persistExpansionHints(doc, collectExpansion(doc, opts));
    xml = await doc.toXml();
    layout = { status: 'skipped', warnings: [], expanded: [], metrics: metricsDelta(before.metrics, layoutProblems(doc.definitions)) };
  } else if (formatOnly && requested !== 'full' && before.snapshot.flowNodeShapes > 0) {
    // nothing semantic changed: the drawing is kept as it is and only formatted
    xml = await doc.toXml();
    layout = { status: 'ok', mode: 'incremental', reason: 'format operations only: drawing kept', warnings: [], expanded: [] };
  } else {
    let givenIds: GivenId[] | undefined;
    try {
      ({ xml, layout, givenIds } = await runLayout(doc, requested, before, ran, opts));
    } catch (err) {
      throw toCliError(err);
    }
    if (givenIds?.length) {
      for (const g of givenIds) changes.change({ id: g.id, kind: g.kind, ...(g.name ? { name: g.name } : {}), detail: 'id added (it had none; the diagram refers to elements by id)' });
      changes.note(`${givenIds.length} element(s) without id got one in the file's id style so that the redrawn diagram can show them: ${givenIds.map((g) => g.id).join(', ')}`);
    }
  }

  const entries = formatEntries(doc, ran);
  if (entries.length) {
    const formatted = await runFormat(xml, doc.file, entries);
    xml = formatted.xml;
    layout.format = formatted.results;
    layout.metrics = metricsDelta(before.metrics, formatted.after);
  }
  const followed = await moveStickies(xml, resolveAnchors(doc, before.stickies));
  xml = followed.xml;
  if (followed.moved.length) layout.stickies = followed.moved;

  xml = await outputText(doc, xml, asRead, changes);

  if (validators.length) {
    // the candidate: exactly what would be written (after the text-preserving post-pass)
    const candidate = xml;
    const after = await runValidators(validators, { xml: async () => candidate, doc: once(() => Doc.fromXml(candidate, file)) }, { ...vctx, phase: 'after' });
    const reports = compareRuns(validatorsBefore, after, renamesOf(doc, baseline.index));
    const introduced = reports.flatMap((r) => r.errors);
    if (introduced.length && !opts.force) throw validatorRefusal(introduced);
    validation = withValidatorReports(validation, reports, after);
  }

  const unchanged = doc.source !== undefined && xml === doc.source.text;

  const result: MutationResult = {
    ok: true,
    ...(doc.file ? { file: doc.file } : {}),
    written: false,
    unchanged,
    changes,
    ...(Object.keys(aliases).length ? { aliases } : {}),
    layout,
    validation,
    importWarnings,
    xml,
  };
  if (opts.show) {
    const fresh = await Doc.fromXml(xml, doc.file);
    result.view = buildView(fresh);
  }
  return result;
}

/** Options of `bpmn layout` (layoutDoc): a full redraw, or with `tidy` only overlaps removed. */
export interface LayoutDocOptions extends Omit<MutationOptions, 'layout'> {
  /** keep the drawing and only remove overlaps and gaps < 20 px (= `bpmn layout --tidy`); expand / collapse must be absent */
  tidy?: boolean;
}

/** E_USAGE for layout options that contradict each other (checked before anything is read). */
export function assertLayoutOptions(opts: LayoutDocOptions): void {
  if (opts.tidy && (opts.expand !== undefined || opts.collapse !== undefined)) {
    throw usageError('--tidy keeps the drawing; --expand / --collapse need a redraw', { hint: 'Run `bpmn layout <file> --expand ...` and `bpmn layout <file> --tidy` separately.' });
  }
}

/**
 * `bpmn layout` on an in-memory document: redraws the diagram (expanding /
 * collapsing the given sub-processes, reported as changes), or with `tidy`
 * keeps it and only removes overlaps. Unknown ids and ids that are no
 * sub-process are errors (like `set <id> expanded=`), not silent no-ops.
 */
export async function layoutDoc(doc: Doc, opts: LayoutDocOptions = {}): Promise<MutationResult> {
  assertLayoutOptions(opts);
  if (opts.tidy) return mutateDoc(doc, [{ op: 'tidy' }], { ...opts, layout: 'auto' });
  const expand = opts.expand ?? [];
  const collapse = opts.collapse ?? [];
  const subs = new Map([...expand, ...collapse].map((id) => [id, doc.require(id, SUB_PROCESS_TYPES, 'sub-process')]));
  const both = expand.filter((id) => collapse.includes(id));
  if (both.length) throw usageError(`${both.join(', ')} given to both --expand and --collapse`);
  const result = await mutateDoc(doc, [], { ...opts, layout: 'full', expand, collapse });
  for (const [id, expanded] of [...expand.map((id) => [id, true] as const), ...collapse.map((id) => [id, false] as const)]) {
    const sub = subs.get(id)!;
    const name = sub.get<string | undefined>('name');
    result.changes.change({ id, kind: kindLabel(sub), ...(name ? { name } : {}), detail: `expanded=${expanded}` });
  }
  return result;
}

/** Options of `bpmn validate` (checkDoc, checkFile, validateXml). */
export interface CheckOptions {
  /** platform profile: 'auto' (default) detects it */
  platform?: PlatformChoice;
  /** validation profile: 'auto' (default: design for the models of a design-iq content repository), 'design', 'none' */
  profile?: ProfileChoice;
  /** the design-iq content repository of the document (see MutationOptions.contentRepo; checkFile finds it on disk) */
  contentRepo?: ContentRepo;
  /** further validators (src/validators.ts), run on the document's XML */
  validators?: Validator[];
  /** the file being checked, for the validators (default doc.file) */
  file?: string;
  /** receives the layout engines' diagnostic lines during this call */
  debug?: DebugSink;
}

/** What `bpmn validate` finds in a document (checkDoc). */
export interface CheckResult {
  validation: ValidationResult;
  layout: LayoutStatus | { status: 'failed'; error: Warning };
  importWarnings: string[];
  /** the validation profile that ran (or why none did) */
  profile: ProfileInfo;
}

/**
 * Validation (with the platform profile, auto-detected unless `opts.platform`),
 * the validators (the validation profile and `opts.validators`, every finding
 * reported; their errors fail the check) and a layout dry run. The dry run
 * redraws the in-memory document: pass a document of its own (validateXml
 * and checkFile parse one).
 */
export async function checkDoc(doc: Doc, opts: CheckOptions = {}): Promise<CheckResult> {
  return withLayoutDebug(opts.debug, async () => {
    let validation = validateDoc(doc, { platform: opts.platform ?? 'auto' });
    const structuralErrors = validation.errors.length;
    const importWarnings = reportedImportWarnings(doc).map((w) => w.message.split('\n')[0]!);
    const file = opts.file ?? doc.file;
    const profile = resolveProfile(opts.profile ?? 'auto', opts.contentRepo);
    const validators: NamedValidator[] = [...profileValidators(profile, file), ...namedValidators(opts.validators)];
    if (validators.length) {
      // before the layout dry run, which redraws the model in memory: the validators see the document's own diagram
      const runs = await runValidators(validators, { xml: once(async () => doc.source?.text ?? (await doc.toXml())), doc: async () => doc }, { ...(file ? { file } : {}), phase: 'check', platform: resolvePlatform(doc, opts.platform ?? 'auto').platform, ops: [] });
      validation = withValidatorReports(validation, checkReports(runs), runs);
    }
    let layout: CheckResult['layout'];
    if (structuralErrors) {
      layout = { status: 'skipped', warnings: [], expanded: [] };
    } else {
      try {
        const r = await layoutModel(doc.model, {});
        layout = { status: 'ok', warnings: r.warnings, expanded: r.expanded };
      } catch (err) {
        const e = toCliError(err) as CliError;
        layout = { status: 'failed', error: { code: e.code, message: e.message, element: e.details?.element as string | undefined } };
      }
    }
    return { validation, layout, importWarnings, profile };
  });
}

export function isProcessLike(el: El): boolean {
  return is(el, 'bpmn:Process') || is(el, 'bpmn:SubProcess');
}
