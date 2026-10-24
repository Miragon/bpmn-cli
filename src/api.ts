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
 *   viewXml(xml, opts)           `bpmn show --json` (an element with id, its context with id + context,
 *                                the neighbourhood with around, the drawing with layout)
 *   showXml(xml, opts)           `bpmn show` as text
 *   conventionsXml(xml, opts)    `bpmn show --conventions --json` (xml undefined: a new file)  -> ConventionsView
 *   metricsXml(xml)              `bpmn metrics --json`                           -> { score, counts, problems }
 *   findXml(xml, text, opts)     `bpmn find --json`                              -> FindHit[]
 *   extensionsXml(xml, id)       `bpmn ext list --json`                          -> ExtensionInfo[]
 *
 * Writing functions return { xml, unchanged, result }: the new document,
 * whether it is byte-identical to the input (nothing to save), and what the
 * CLI prints with --json (changes, warnings, layout, validation, import
 * warnings; the model view with `show`), without the XML. renderMutation
 * (src/report/command-report.ts) gives the CLI's text for it. The CLI's guards apply: a
 * lossy import (E_IMPORT_LOSSY), validation errors the ops would introduce
 * (E_VALIDATION) and content a retype would delete (E_WOULD_DROP_CONTENT)
 * are refused unless `force`; the layout modes, the format ops and the
 * platform profile's new findings work as in the CLI, a host's own
 * validators (`validators`) run in the same transaction, `keepFlowIds`
 * keeps flow ids like `--keep-flow-ids`, and `conventions` are the declared
 * id conventions new ids follow (src/ids/IdConventionsReader.ts; a host that lints with
 * element-id-naming builds them from the same configuration). The result
 * keeps the input's text wherever the ops changed nothing (the
 * text-preserving step).
 *
 * Errors are CliError instances (code, category, details with element,
 * candidates, hint, op), exactly what the CLI prints with --json; the input
 * string is never modified.
 */
import { OpsParser } from './ops/OpsParser.js';
import { LayoutDebug, type DebugSink } from './shared/LayoutDebug.js';
import type { LayoutMetrics } from './diagram/utils/problems.js';
import type { LayoutView } from './query/layout-view.js';
import type { AroundView, ElementContext } from './query/context.js';
import { LayoutViewBuilder } from './query/LayoutViewBuilder.js';
import { AroundWindow } from './query/AroundWindow.js';
import { ElementContextBuilder } from './query/ElementContextBuilder.js';
import { LayoutAnalysis } from './diagram/LayoutAnalysis.js';
import type { BpmnlintSeverity } from './validate/bpmnlint-validator.js';
import { ConventionsTable, type ConventionsView, type Undeclared } from './ids/ConventionsTable.js';
import type { IdConventions } from './ids/IdConventionsReader.js';
import { Doc, type NewDocOptions } from './model/Doc.js';
import { CliError } from './shared/CliError.js';
import { usageError } from './shared/utils/errors.js';
import { parseOpsJson } from './shared/utils/ops-json.js';
import { AroundText } from './report/AroundText.js';
import { ContextText } from './report/ContextText.js';
import { DetailText } from './report/DetailText.js';
import { LayoutText } from './report/LayoutText.js';
import { ModelViewText } from './report/ModelViewText.js';
import { assertKindToken } from './model/utils/kinds.js';
import type { LayoutEngine } from './layout/FullLayout.js';
import { ExtensionLister, type ExtensionInfo } from './ops/ExtensionLister.js';
import type { Op } from './ops/types.js';
import type { LayoutMode, MutationResult } from './pipeline/index.js';
import { EditTransaction } from './pipeline/EditTransaction.js';
import { Relayout } from './pipeline/Relayout.js';
import { DocCheck } from './pipeline/DocCheck.js';
import type { PlatformChoice } from './platform/PlatformDetection.js';
import { type MutationReport, type ValidationReport } from './report/command-report.js';
import type { Validator, ValidatorFinding } from './validate/validators.js';
import { type ElementDetail, type FindHit, type ModelView } from './query/model-view.js';
import { ViewRequest, type ShownView, type ViewOptions } from './query/ViewRequest.js';
import { newProcessChange } from './model/utils/new-process.js';
import { metricsJson } from './report/utils/metrics-json.js';
import { ValidationReportBuilder } from './report/ValidationReportBuilder.js';
import { MutationReportBuilder } from './report/MutationReportBuilder.js';
import { ElementFinder } from './query/ElementFinder.js';

export type { ShownView, ViewOptions } from './query/ViewRequest.js';

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
  /** validators run on the candidate XML inside the transaction: errors a change introduces refuse it (E_VALIDATION), unless the validator is advisory (`blocks: false`, e.g. bpmnlintValidator: reported among the warnings) */
  validators?: Validator[];
  /** the document's file name, for the validators (`ctx.file`) */
  file?: string;
  /**
   * keep the id of every existing sequence flow when the ops give it other ends (`--keep-flow-ids`):
   * W_FLOW_ID_STALE names each one whose id no longer names its ends; default false: such a flow is renamed after its new ends
   */
  keepFlowIds?: boolean;
  /**
   * declared id conventions (idConventionsFromLint on element-id-naming, or a table of your own): ids the ops generate
   * follow them where they declare a prefix, the file's own style elsewhere; existing ids stay
   */
  conventions?: IdConventions;
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
  const { file: _file, written: _written, ...report } = new MutationReportBuilder(mutation).report();
  return { xml: unchanged ? input : mutation.xml, unchanged, result: report };
}

/** The ops of applyToXml: an array, `{ ops: [...] }` or the JSON text of either, checked like `bpmn apply`. */
function readOps(ops: unknown): Op[] {
  return new OpsParser().parse(typeof ops === 'string' ? parseOpsJson(ops) : ops);
}

/** Parses a document for a write: E_PARSE, and E_IMPORT_LOSSY unless force (like the CLI's loadDoc). */
async function loadXml(xml: string, opts: { force?: boolean }): Promise<Doc> {
  const doc = await Doc.fromXml(xml);
  doc.assertLossless(opts);
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
  return toEditResult(xml, await new EditTransaction(doc, list, opts).run());
}

/** `bpmn new`: a document with one empty process (processName, processId, executable, target, conventions), laid out. */
export async function newXml(opts: NewDocOptions & EditOptions = {}): Promise<EditResult> {
  const doc = Doc.create({ processName: opts.processName, processId: opts.processId, executable: opts.executable, target: opts.target, ...(opts.conventions ? { conventions: opts.conventions } : {}) });
  const mutation = await new EditTransaction(doc, [], opts).run();
  mutation.changes.create(newProcessChange(doc, opts.processName));
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
  const relayout = new Relayout(opts);
  relayout.assertOptions();
  const doc = await loadXml(xml, opts);
  return toEditResult(xml, await relayout.run(doc));
}

/** Options of validateXml (`bpmn validate`). */
export interface ValidateXmlOptions {
  /** platform profile: 'auto' (default) detects it, 'c7', 'c8', 'none' */
  platform?: PlatformChoice;
  /** validators; every finding is reported, their errors make `ok` false */
  validators?: Validator[];
  /** the document's file name, for the validators (`ctx.file`) */
  file?: string;
  /** receives the layout engines' diagnostic lines of this call */
  debug?: DebugSink;
}

/** `bpmn validate --json`: structure, lint, the platform profile, the validators and a layout dry run. `ok` is false on errors. */
export async function validateXml(xml: string, opts: ValidateXmlOptions = {}): Promise<ValidationReport> {
  return new ValidationReportBuilder(await new DocCheck(opts).run(await Doc.fromXml(xml, opts.file))).report();
}

/** `bpmn show` on a parsed document: the view the options ask for (see ViewOptions). */
export function viewDoc(doc: Doc, opts: ViewOptions = {}): ShownView {
  return new ViewRequest(opts).of(doc);
}

/** The text of a view, as `bpmn show` prints it (without the final newline). */
export function renderShown(v: ShownView): string {
  const text =
    v.kind === 'layout' ? new LayoutText(v.view).text() : v.kind === 'detail' ? new DetailText(v.view).text() : v.kind === 'context' ? new ContextText(v.view).text() : v.kind === 'around' ? new AroundText(v.view).text() : new ModelViewText(v.view).text();
  return text.replace(/\n$/, '');
}

/** `bpmn show --json`: the model as the agent sees it (no coordinates), one element with `id` (with `context`: in its context), the neighbourhood with `around`, the drawing with `layout`. */
export function viewXml(xml: string, opts: ViewOptions & { layout: true }): Promise<LayoutView>;
export function viewXml(xml: string, opts: ViewOptions & { around: string }): Promise<AroundView>;
export function viewXml(xml: string, opts: ViewOptions & { id: string; context: true }): Promise<ElementContext>;
export function viewXml(xml: string, opts: ViewOptions & { id: string }): Promise<ElementDetail>;
export function viewXml(xml: string, opts?: ViewOptions): Promise<ModelView>;
export async function viewXml(xml: string, opts: ViewOptions = {}): Promise<ModelView | ElementDetail | ElementContext | AroundView | LayoutView> {
  const request = new ViewRequest(opts);
  return request.of(await Doc.fromXml(xml)).view;
}

/** `bpmn show`: the same as text, exactly as the CLI prints it (without the final newline). */
export async function showXml(xml: string, opts: ViewOptions = {}): Promise<string> {
  const request = new ViewRequest(opts);
  return renderShown(request.of(await Doc.fromXml(xml)));
}

export interface ConventionsXmlOptions {
  conventions?: IdConventions;
  file?: string;
  severity?: BpmnlintSeverity;
  notes?: ValidatorFinding[];
  where?: string;
  undeclared?: Undeclared;
}

/**
 * `bpmn show --conventions --json`: the conventions new ids follow in a
 * document (undefined: a new file), `conventions` declared over its own
 * style; `severity` and `notes` as idConventionsFromLint and the
 * configuration give them, `where` and `undeclared` where the configuration
 * is and why it declares none.
 */
export async function conventionsXml(xml: string | undefined, opts: ConventionsXmlOptions = {}): Promise<ConventionsView> {
  const { conventions, ...rest } = opts;
  return new ConventionsTable(xml === undefined ? undefined : await Doc.fromXml(xml, opts.file), conventions).view(rest);
}

/** `bpmn metrics --json`: the layout score, the count per kind and every problem with its element ids. */
export async function metricsXml(xml: string): Promise<Pick<LayoutMetrics, 'score' | 'counts' | 'problems'>> {
  return metricsJson(LayoutAnalysis.of((await Doc.fromXml(xml)).definitions));
}

/** `bpmn find --json`: elements whose id, name or vendor value contains `text` (case-insensitive), optionally of one kind. */
export async function findXml(xml: string, text: string, opts: { kind?: string } = {}): Promise<FindHit[]> {
  if (opts.kind !== undefined) assertKindToken(opts.kind);
  return new ElementFinder(await Doc.fromXml(xml)).find(text, opts.kind);
}

/** `bpmn ext list --json`: the extension elements of an element (and of its event definition / loop / condition). */
export async function extensionsXml(xml: string, id: string): Promise<ExtensionInfo[]> {
  const doc = await Doc.fromXml(xml);
  return new ExtensionLister().listAll(doc.require(id));
}

/** Sets (or, without an argument, clears) the process-wide sink of the layout engines' diagnostic lines. */
export function setLayoutDebug(sink?: DebugSink): void {
  LayoutDebug.setProcessSink(sink);
}
