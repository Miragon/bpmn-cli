/**
 * The in-memory API: strings in, strings and data out. Every function runs
 * the same code as the CLI command it names, without reading or writing a
 * file and without touching the environment, so it runs in Node and in the
 * browser (test/isomorphic.test.ts bundles it for the browser and runs it in
 * a context without Node globals).
 *
 *   applyToXml(xml, ops, opts)   `bpmn apply`: ops JSON (array, {ops}, or its text) -> EditResult
 *   newXml(opts)                 `bpmn new`                                      -> EditResult
 *   layoutXml(xml, opts)         `bpmn layout` (expand / collapse / tidy)         -> EditResult
 *   validateXml(xml, opts)       `bpmn validate --json`                          -> ValidationReport
 *   viewXml(xml, opts)           `bpmn show --json` (an element with id, the drawing with layout)
 *   showXml(xml, opts)           `bpmn show` as text
 *   metricsXml(xml)              `bpmn metrics --json`                           -> { score, counts, problems }
 *   findXml(xml, text, opts)     `bpmn find --json`                              -> FindHit[]
 *   extensionsXml(xml, id)       `bpmn ext list --json`                          -> ExtensionInfo[]
 *
 * Writing functions return { xml, unchanged, result }: the new document,
 * whether it is byte-identical to the input (nothing to save), and what the
 * CLI prints with --json (changes, warnings, layout, validation, import
 * warnings; the model view with `show`), without the XML. renderMutation
 * (src/report.ts) gives the CLI's text for it. The CLI's guards apply: a
 * lossy import (E_IMPORT_LOSSY), validation errors the ops would introduce
 * (E_VALIDATION) and content a retype would delete (E_WOULD_DROP_CONTENT)
 * are refused unless `force`; the layout modes, the format ops and the
 * platform profile's new findings work as in the CLI.
 *
 * Errors are CliError instances (code, category, details with element,
 * candidates, hint, op), exactly what the CLI prints with --json; the input
 * string is never modified.
 */
import { parseOps } from './batch.js';
import type { DebugSink } from './debug.js';
import { layoutProblems, type LayoutMetrics } from './diagram/metrics.js';
import { layoutView, type LayoutView } from './diagram/view.js';
import { Doc, type NewDocOptions } from './document.js';
import { CliError, usageError } from './errors.js';
import { renderDetail, renderLayoutView, renderView } from './format.js';
import { assertKindToken } from './kinds.js';
import type { LayoutEngine } from './layout.js';
import { listAllExtensions, type ExtensionInfo } from './ops/ext.js';
import type { Op } from './ops/types.js';
import { assertLayoutOptions, assertLossless, checkDoc, layoutDoc, mutateDoc, type LayoutMode, type MutationResult } from './pipeline.js';
import type { PlatformChoice } from './platform/profile.js';
import { mutationReport, validationReport, type MutationReport, type ValidationReport } from './report.js';
import { buildView, elementDetail, findElements, scopeView, type ElementDetail, type FindHit, type ModelView } from './view.js';

/** Options of the writing functions (the CLI's mutation flags). */
export interface EditOptions {
  /** 'auto' (default, also true): keep a hand-made drawing, redraw an engine-owned one; 'incremental'; 'full'; false: no layout */
  layout?: boolean | LayoutMode;
  /** layout engine of full redraws: 'clean' (default) or 'auto' (bpmn-auto-layout) */
  engine?: LayoutEngine;
  /** write despite a lossy import, new validation errors or content a retype would delete */
  force?: boolean;
  /** platform profile whose new findings are reported: 'auto' (default), 'c7', 'c8', 'none' */
  platform?: PlatformChoice;
  /** include the model view of the result (`--show`) */
  show?: boolean;
  /** receives the layout engines' diagnostic lines of this call (what BPMN_LAYOUT_DEBUG prints) */
  debug?: DebugSink;
}

/** What a writing function reports: the CLI's --json output of a mutation without file and written. */
export type EditReport = Omit<MutationReport, 'file' | 'written'>;

export interface EditResult {
  /** the new document (the input string itself when unchanged) */
  xml: string;
  /** true when the new document is byte-identical to the input: there is nothing to save */
  unchanged: boolean;
  /** changes, warnings, layout, validation, import warnings (and the view with `show`); no XML */
  result: EditReport;
}

function toEditResult(input: string | undefined, mutation: MutationResult): EditResult {
  const unchanged = input !== undefined && mutation.xml === input;
  const { file: _file, written: _written, ...report } = mutationReport(mutation);
  return { xml: unchanged ? input : mutation.xml, unchanged, result: report };
}

/** The ops of applyToXml: an array, `{ ops: [...] }` or the JSON text of either, checked like `bpmn apply`. */
function readOps(ops: unknown): Op[] {
  if (typeof ops !== 'string') return parseOps(ops);
  let parsed: unknown;
  try {
    parsed = JSON.parse(ops);
  } catch (err) {
    throw new CliError('E_USAGE', `Ops are not valid JSON: ${(err as Error).message}`, 'usage');
  }
  return parseOps(parsed);
}

/** Parses a document for a write: E_PARSE, and E_IMPORT_LOSSY unless force (like the CLI's loadDoc). */
async function loadXml(xml: string, opts: { force?: boolean }): Promise<Doc> {
  const doc = await Doc.fromXml(xml);
  assertLossless(doc, opts);
  return doc;
}

/**
 * `bpmn apply`: applies ops (the ops JSON of `bpmn apply`, see OPS_SCHEMA:
 * an array, `{ ops: [...] }`, or the JSON text of either) to a document in
 * one transaction, then validates and lays it out.
 */
export async function applyToXml(xml: string, ops: unknown, opts: EditOptions = {}): Promise<EditResult> {
  const list = readOps(ops);
  const doc = await loadXml(xml, opts);
  return toEditResult(xml, await mutateDoc(doc, list, opts));
}

/** `bpmn new`: a document with one empty process (processName, processId, executable, target), laid out. */
export async function newXml(opts: NewDocOptions & EditOptions = {}): Promise<EditResult> {
  const doc = Doc.create({ processName: opts.processName, processId: opts.processId, executable: opts.executable, target: opts.target });
  const mutation = await mutateDoc(doc, [], opts);
  mutation.changes.create({ id: doc.processes()[0]!.get<string>('id'), kind: 'process', name: opts.processName });
  return toEditResult(undefined, mutation);
}

/** Options of layoutXml (`bpmn layout`). */
export interface LayoutXmlOptions extends Omit<EditOptions, 'layout'> {
  /** sub-process ids to draw expanded (reported as changes) */
  expand?: string[];
  /** sub-process ids to draw collapsed */
  collapse?: string[];
  /** keep the drawing and only remove overlaps and gaps < 20 px (no expand / collapse) */
  tidy?: boolean;
}

/** `bpmn layout`: redraws the diagram (with expand / collapse), or with `tidy` keeps it and removes overlaps. */
export async function layoutXml(xml: string, opts: LayoutXmlOptions = {}): Promise<EditResult> {
  assertLayoutOptions(opts);
  const doc = await loadXml(xml, opts);
  return toEditResult(xml, await layoutDoc(doc, opts));
}

/** `bpmn validate --json`: structure, lint, the platform profile and a layout dry run. `ok` is false on errors. */
export async function validateXml(xml: string, opts: { platform?: PlatformChoice; debug?: DebugSink } = {}): Promise<ValidationReport> {
  return validationReport(await checkDoc(await Doc.fromXml(xml), opts));
}

/** What viewXml / showXml show: the model (default, optionally one scope), one element, or the drawing. */
export interface ViewOptions {
  /** one element in detail (`bpmn show <file> <id>`) */
  id?: string;
  /** only this process / participant / sub-process (`--scope`) */
  scope?: string;
  /** the drawing instead of the model: rows, colours, label sides, layout problems (`--layout`) */
  layout?: boolean;
}

async function viewOf(xml: string, opts: ViewOptions): Promise<{ kind: 'model'; view: ModelView } | { kind: 'detail'; view: ElementDetail } | { kind: 'layout'; view: LayoutView }> {
  const doc = await Doc.fromXml(xml);
  if (opts.layout) {
    if (opts.id || opts.scope) throw usageError('--layout shows the whole drawing; drop the element id / --scope', { hint: 'Use `bpmn show <file> --layout` and look up the id in the rows.' });
    return { kind: 'layout', view: layoutView(doc.definitions) };
  }
  if (opts.id) return { kind: 'detail', view: elementDetail(doc, doc.require(opts.id)) };
  const view = buildView(doc);
  return { kind: 'model', view: opts.scope ? scopeView(doc, view, opts.scope) : view };
}

/** `bpmn show --json`: the model as the agent sees it (no coordinates), one element with `id`, the drawing with `layout`. */
export function viewXml(xml: string, opts: ViewOptions & { layout: true }): Promise<LayoutView>;
export function viewXml(xml: string, opts: ViewOptions & { id: string }): Promise<ElementDetail>;
export function viewXml(xml: string, opts?: ViewOptions): Promise<ModelView>;
export async function viewXml(xml: string, opts: ViewOptions = {}): Promise<ModelView | ElementDetail | LayoutView> {
  return (await viewOf(xml, opts)).view;
}

/** `bpmn show`: the same as text, exactly as the CLI prints it (without the final newline). */
export async function showXml(xml: string, opts: ViewOptions = {}): Promise<string> {
  const v = await viewOf(xml, opts);
  const text = v.kind === 'layout' ? renderLayoutView(v.view) : v.kind === 'detail' ? renderDetail(v.view) : renderView(v.view);
  return text.replace(/\n$/, '');
}

/** `bpmn metrics --json`: the layout score, the count per kind and every problem with its element ids. */
export async function metricsXml(xml: string): Promise<Pick<LayoutMetrics, 'score' | 'counts' | 'problems'>> {
  const m = layoutProblems((await Doc.fromXml(xml)).definitions);
  return { score: m.score, counts: m.counts, problems: m.problems };
}

/** `bpmn find --json`: elements whose id, name or vendor value contains `text` (case-insensitive), optionally of one kind. */
export async function findXml(xml: string, text: string, opts: { kind?: string } = {}): Promise<FindHit[]> {
  if (opts.kind !== undefined) assertKindToken(opts.kind);
  return findElements(await Doc.fromXml(xml), text, opts.kind);
}

/** `bpmn ext list --json`: the extension elements of an element (and of its event definition / loop / condition). */
export async function extensionsXml(xml: string, id: string): Promise<ExtensionInfo[]> {
  const doc = await Doc.fromXml(xml);
  return listAllExtensions(doc.require(id));
}
