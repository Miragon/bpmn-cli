/**
 * The in-memory API: strings in, strings and data out. Each function runs the same code as the
 * CLI command it names, without files or environment, so it runs in Node and in the browser.
 * Errors are CliError instances, exactly what the CLI prints with --json.
 */
import { OpsParser } from './ops/parsing/OpsParser.js';
import { LayoutDebug, type DebugSink } from './layout/LayoutDebug.js';
import type { LayoutMetrics } from './drawing/utils/problems.js';
import type { LayoutView } from './query/layout-view.js';
import type { AroundView, ElementContext } from './query/context.js';
import { LayoutViewBuilder } from './query/LayoutViewBuilder.js';
import { AroundWindow } from './query/AroundWindow.js';
import { ElementContextBuilder } from './query/ElementContextBuilder.js';
import { LayoutAnalysis } from './drawing/LayoutAnalysis.js';
import type { BpmnlintSeverity } from './validate/bpmnlint-validator.js';
import { ConventionsTable, type ConventionsView, type Undeclared } from './ids/ConventionsTable.js';
import type { IdConventions } from './ids/IdConventionsReader.js';
import { Doc, type NewDocOptions } from './model/Doc.js';
import { CliError } from './shared/CliError.js';
import { usageError } from './shared/utils/errors.js';
import { parseOpsJson } from './ops/parsing/utils/ops-json.js';
import { AroundText } from './report/AroundText.js';
import { ContextText } from './report/ContextText.js';
import { DetailText } from './report/DetailText.js';
import { LayoutText } from './report/LayoutText.js';
import { ModelViewText } from './report/ModelViewText.js';
import { assertKindToken } from './model/utils/kinds.js';
import type { LayoutEngine } from './layout/FullLayout.js';
import { ExtensionLister, type ExtensionInfo } from './model/ExtensionLister.js';
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
  /** 'auto' (default): keep a hand-made drawing, redraw an engine-owned one; false: no layout */
  layout?: boolean | LayoutMode;
  /** layout engine of full redraws: 'clean' (default) or 'auto' (bpmn-auto-layout) */
  engine?: LayoutEngine;
  /** write despite a lossy import, new validation errors or content a retype would delete */
  force?: boolean;
  /** platform profile whose new findings are reported: 'auto' (default), 'c7', 'c8', 'none' */
  platform?: PlatformChoice;
  /** a change's new errors refuse it (E_VALIDATION), unless the validator has `blocks: false` */
  validators?: Validator[];
  /** the document's file name, for the validators (`ctx.file`) */
  file?: string;
  /** keep existing flow ids when the ops give the flow other ends (`--keep-flow-ids`) */
  keepFlowIds?: boolean;
  /** new ids follow them where they declare a prefix, the file's own style elsewhere */
  conventions?: IdConventions;
  /** include the model view of the result (`--show`) */
  show?: boolean;
  /** receives the layout engines' diagnostic lines of this call */
  debug?: DebugSink;
}

/** What a writing function reports: the CLI's --json output without file and written. */
export type EditReport = Omit<MutationReport, 'file' | 'written'>;

export interface EditResult {
  xml: string;
  /** byte-identical to the input: nothing to save */
  unchanged: boolean;
  result: EditReport;
}

function toEditResult(input: string | undefined, mutation: MutationResult): EditResult {
  const unchanged = input !== undefined && mutation.xml === input;
  const { file: _file, written: _written, ...report } = new MutationReportBuilder(mutation).report();
  return { xml: unchanged ? input : mutation.xml, unchanged, result: report };
}

function readOps(ops: unknown): Op[] {
  return new OpsParser().parse(typeof ops === 'string' ? parseOpsJson(ops) : ops);
}

async function loadXml(xml: string, opts: { force?: boolean }): Promise<Doc> {
  const doc = await Doc.fromXml(xml);
  doc.assertLossless(opts);
  return doc;
}

/** `bpmn apply`: applies ops (an array, `{ ops }` or its JSON text) in one transaction. */
export async function applyToXml(xml: string, ops: unknown, opts: EditOptions = {}): Promise<EditResult> {
  const list = readOps(ops);
  const doc = await loadXml(xml, opts);
  return toEditResult(xml, await new EditTransaction(doc, list, opts).run());
}

/** `bpmn new`: a laid-out document with one empty process. */
export async function newXml(opts: NewDocOptions & EditOptions = {}): Promise<EditResult> {
  const doc = Doc.create({ processName: opts.processName, processId: opts.processId, executable: opts.executable, target: opts.target, ...(opts.conventions ? { conventions: opts.conventions } : {}) });
  const mutation = await new EditTransaction(doc, [], opts).run();
  mutation.changes.create(newProcessChange(doc, opts.processName));
  return toEditResult(undefined, mutation);
}

export interface LayoutXmlOptions extends Omit<EditOptions, 'layout'> {
  expand?: string[];
  collapse?: string[];
  /** keep the drawing and only remove overlaps and gaps < 20 px */
  tidy?: boolean;
}

/** `bpmn layout`: redraws the diagram, or with `tidy` keeps it and removes overlaps. */
export async function layoutXml(xml: string, opts: LayoutXmlOptions = {}): Promise<EditResult> {
  const relayout = new Relayout(opts);
  relayout.assertOptions();
  const doc = await loadXml(xml, opts);
  return toEditResult(xml, await relayout.run(doc));
}

export interface ValidateXmlOptions {
  platform?: PlatformChoice;
  /** every finding is reported, their errors make `ok` false */
  validators?: Validator[];
  file?: string;
  debug?: DebugSink;
}

/** `bpmn validate --json`: structure, lint, platform profile, validators and a layout dry run. */
export async function validateXml(xml: string, opts: ValidateXmlOptions = {}): Promise<ValidationReport> {
  return new ValidationReportBuilder(await new DocCheck(opts).run(await Doc.fromXml(xml, opts.file))).report();
}

/** `bpmn show` on a parsed document. */
export function viewDoc(doc: Doc, opts: ViewOptions = {}): ShownView {
  return new ViewRequest(opts).of(doc);
}

/** The text of a view as `bpmn show` prints it, without the final newline. */
export function renderShown(shown: ShownView): string {
  const text =
    shown.kind === 'layout' ? new LayoutText(shown.view).text() : shown.kind === 'detail' ? new DetailText(shown.view).text() : shown.kind === 'context' ? new ContextText(shown.view).text() : shown.kind === 'around' ? new AroundText(shown.view).text() : new ModelViewText(shown.view).text();
  return text.replace(/\n$/, '');
}

/** `bpmn show --json`: the model as the agent sees it, or one element, its area, the drawing. */
export function viewXml(xml: string, opts: ViewOptions & { layout: true }): Promise<LayoutView>;
export function viewXml(xml: string, opts: ViewOptions & { around: string }): Promise<AroundView>;
export function viewXml(xml: string, opts: ViewOptions & { id: string; context: true }): Promise<ElementContext>;
export function viewXml(xml: string, opts: ViewOptions & { id: string }): Promise<ElementDetail>;
export function viewXml(xml: string, opts?: ViewOptions): Promise<ModelView>;
export async function viewXml(xml: string, opts: ViewOptions = {}): Promise<ModelView | ElementDetail | ElementContext | AroundView | LayoutView> {
  const request = new ViewRequest(opts);
  return request.of(await Doc.fromXml(xml)).view;
}

/** `bpmn show`: the view as text, exactly as the CLI prints it. */
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

/** `bpmn show --conventions --json`: the id conventions new ids follow (no xml: a new file). */
export async function conventionsXml(xml: string | undefined, opts: ConventionsXmlOptions = {}): Promise<ConventionsView> {
  const { conventions, ...rest } = opts;
  return new ConventionsTable(xml === undefined ? undefined : await Doc.fromXml(xml, opts.file), conventions).view(rest);
}

/** `bpmn metrics --json`: the layout score, the count per kind and every problem. */
export async function metricsXml(xml: string): Promise<Pick<LayoutMetrics, 'score' | 'counts' | 'problems'>> {
  return metricsJson(LayoutAnalysis.of((await Doc.fromXml(xml)).definitions));
}

/** `bpmn find --json`: elements whose id, name or vendor value contains `text` (any case). */
export async function findXml(xml: string, text: string, opts: { kind?: string } = {}): Promise<FindHit[]> {
  if (opts.kind !== undefined) assertKindToken(opts.kind);
  return new ElementFinder(await Doc.fromXml(xml)).find(text, opts.kind);
}

/** `bpmn ext list --json`: the extension elements of an element and its definitions. */
export async function extensionsXml(xml: string, id: string): Promise<ExtensionInfo[]> {
  const doc = await Doc.fromXml(xml);
  return new ExtensionLister().listAll(doc.require(id));
}

/** Sets or, without an argument, clears the process-wide sink of layout diagnostics. */
export function setLayoutDebug(sink?: DebugSink): void {
  LayoutDebug.setProcessSink(sink);
}
