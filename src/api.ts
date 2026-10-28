/**
 * The in-memory API: strings in, strings and data out. Each function runs the same code as the
 * CLI command it names, without files or environment, so it runs in Node and in the browser.
 * Errors are BpmnError instances, exactly what the CLI prints with --json.
 */
import type { DebugSink } from './domain/diagram/layout/LayoutDebug.js';
import type { LayoutMetrics } from './domain/diagram/utils/problems.js';
import type { LayoutView } from './domain/views/layout-view.js';
import type { AroundView, ElementContext } from './domain/views/around-view.js';
import type { ConventionsView, ConventionsXmlOptions } from './domain/document/ids/ConventionsTable.js';
export type { ConventionsXmlOptions } from './domain/document/ids/ConventionsTable.js';
import type { IdConventions } from './domain/document/ids/IdConventions.js';
import type { Doc, NewDocOptions } from './domain/document/Doc.js';
import type { ExtensionInfo } from './domain/document/ExtensionLister.js';
import type { EditCommand } from './domain/commands/types.js';
import type { MutationOptions, MutationResult } from './domain/batch/types.js';
import type { LayoutMode } from './domain/diagram/types.js';
import type { CheckOptions, CheckResult } from './application/port/in/ValidateDocumentUseCase.js';
import type { LayoutDocOptions } from './application/port/in/RelayoutDiagramUseCase.js';
import { EditDocumentService } from './application/service/EditDocumentService.js';
import { NoProjectSettings } from './adapters/out/memory/NoProjectSettings.js';
import { NoDocumentFiles } from './adapters/out/memory/NoDocumentFiles.js';
import { RelayoutDiagramService } from './application/service/RelayoutDiagramService.js';
import { ValidateDocumentService } from './application/service/ValidateDocumentService.js';
import type { PlatformChoice } from './domain/document/vendor/PlatformDetection.js';
import { type MutationReport, type ValidationReport } from './adapters/in/report/command-report.js';
import type { Validator } from './domain/validation/validators.js';
import { type ElementDetail, type FindHit, type ModelView } from './domain/views/model-view.js';
import type { ShownView, ViewOptions } from './domain/views/ViewRequest.js';
import { ShowModelService } from './application/service/ShowModelService.js';
import { FindElementsService } from './application/service/FindElementsService.js';
import { CreateDocumentService } from './application/service/CreateDocumentService.js';
import { ReadDocumentService } from './application/service/ReadDocumentService.js';
import { RunCommandsService } from './application/service/RunCommandsService.js';
import { ShowConventionsService } from './application/service/ShowConventionsService.js';
import { AnalyzeLayoutService } from './application/service/AnalyzeLayoutService.js';
import { metricsJson } from './adapters/in/report/utils/metrics-json.js';
import { ValidationReportBuilder } from './adapters/in/report/ValidationReportBuilder.js';
import { MutationReportBuilder } from './adapters/in/report/MutationReportBuilder.js';
import { ShownText } from './adapters/in/report/ShownText.js';

/** The in-memory API runs the use cases without files and without a project around the document. */
const NO_PROJECT = new NoProjectSettings();
const NO_FILES = new NoDocumentFiles();
const READ_DOCUMENT = new ReadDocumentService(NO_FILES);

export type { ShownView, ViewOptions } from './domain/views/ViewRequest.js';

/** Options of the writing functions (the CLI's mutation flags). */
export interface EditOptions {
  /** 'auto' (default): keep a hand-made drawing, redraw an engine-owned one; false: no layout */
  layout?: boolean | LayoutMode;
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

function readOps(ops: unknown): EditCommand[] {
  const runCommands = new RunCommandsService();
  return typeof ops === 'string' ? runCommands.parseCommandsJson({ json: ops }) : runCommands.parseCommands({ input: ops });
}

function loadXml(xml: string, opts: { force?: boolean }): Promise<Doc> {
  return READ_DOCUMENT.read({ source: { xml }, lossless: true, ...(opts.force !== undefined ? { force: opts.force } : {}) });
}

function parseXml(xml: string, file?: string): Promise<Doc> {
  return READ_DOCUMENT.read({ source: { xml, ...(file !== undefined ? { file } : {}) } });
}

/** `bpmn apply`: applies ops (an array, `{ ops }` or its JSON text) in one transaction. */
export async function applyToXml(xml: string, ops: unknown, opts: EditOptions = {}): Promise<EditResult> {
  const list = readOps(ops);
  const doc = await loadXml(xml, opts);
  return toEditResult(xml, await new EditDocumentService(NO_PROJECT, NO_FILES).edit({ ...opts, source: { doc }, commands: list, dryRun: true }));
}

/** `bpmn new`: a laid-out document with one empty process. */
export async function newXml(opts: NewDocOptions & EditOptions = {}): Promise<EditResult> {
  return toEditResult(undefined, await new CreateDocumentService(NO_PROJECT, NO_FILES).create({ ...opts, dryRun: true }));
}

export interface LayoutXmlOptions extends Omit<EditOptions, 'layout'> {
  expand?: string[];
  collapse?: string[];
  /** keep the drawing and only remove overlaps and gaps < 20 px */
  tidy?: boolean;
}

/** `bpmn layout`: redraws the diagram, or with `tidy` keeps it and removes overlaps. */
export async function layoutXml(xml: string, opts: LayoutXmlOptions = {}): Promise<EditResult> {
  RelayoutDiagramService.assertOptions(opts);
  const doc = await loadXml(xml, opts);
  return toEditResult(xml, await new RelayoutDiagramService(NO_PROJECT, NO_FILES).relayout({ ...opts, source: { doc }, dryRun: true }));
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
  return new ValidationReportBuilder(await new ValidateDocumentService(NO_PROJECT, NO_FILES).validate({ ...opts, source: { doc: await parseXml(xml, opts.file) } })).report();
}

/** The text of a view as `bpmn show` prints it, without the final newline. */
function renderShown(shown: ShownView): string {
  return new ShownText(shown).text();
}

/** `bpmn show --json`: the model as the agent sees it, or one element, its area, the drawing. */
export function viewXml(xml: string, opts: ViewOptions & { layout: true }): Promise<LayoutView>;
export function viewXml(xml: string, opts: ViewOptions & { around: string }): Promise<AroundView>;
export function viewXml(xml: string, opts: ViewOptions & { id: string; context: true }): Promise<ElementContext>;
export function viewXml(xml: string, opts: ViewOptions & { id: string }): Promise<ElementDetail>;
export function viewXml(xml: string, opts?: ViewOptions): Promise<ModelView>;
export async function viewXml(xml: string, opts: ViewOptions = {}): Promise<ModelView | ElementDetail | ElementContext | AroundView | LayoutView> {
  return new ShowModelService().show({ ...opts, doc: await parseXml(xml) }).view;
}

/** `bpmn show`: the view as text, exactly as the CLI prints it. */
export async function showXml(xml: string, opts: ViewOptions = {}): Promise<string> {
  return renderShown(new ShowModelService().show({ ...opts, doc: await parseXml(xml) }));
}

/** `bpmn show --conventions --json`: the id conventions new ids follow (no xml: a new file). */
export async function conventionsXml(xml: string | undefined, opts: ConventionsXmlOptions = {}): Promise<ConventionsView> {
  return new ShowConventionsService(NO_PROJECT).view({ ...opts, ...(xml !== undefined ? { doc: await parseXml(xml, opts.file) } : {}) });
}

/** `bpmn metrics --json`: the layout score, the count per kind and every problem. */
export async function metricsXml(xml: string): Promise<Pick<LayoutMetrics, 'score' | 'counts' | 'problems'>> {
  return metricsJson(new AnalyzeLayoutService().measure({ definitions: (await parseXml(xml)).definitions }));
}

/** `bpmn find --json`: elements whose id, name or vendor value contains `text` (any case). */
export async function findXml(xml: string, text: string, opts: { kind?: string } = {}): Promise<FindHit[]> {
  const findElements = new FindElementsService();
  if (opts.kind !== undefined) findElements.assertKind({ kind: opts.kind });
  return findElements.find({ doc: await parseXml(xml), text, ...(opts.kind !== undefined ? { kind: opts.kind } : {}) });
}

/** `bpmn ext list --json`: the extension elements of an element and its definitions. */
export async function extensionsXml(xml: string, id: string): Promise<ExtensionInfo[]> {
  const doc = await parseXml(xml);
  return new ShowModelService().allExtensions({ element: doc.require(id) });
}

/** Sets or, without an argument, clears the process-wide sink of layout diagnostics. */
export function setLayoutDebug(sink?: DebugSink): void {
  new RelayoutDiagramService(NO_PROJECT, NO_FILES).setDebugSink(sink !== undefined ? { sink } : {});
}

/** Applies ops to an in-memory document in one batch. */
export function mutateDoc(doc: Doc, ops: EditCommand[], opts: MutationOptions = {}): Promise<MutationResult> {
  return new EditDocumentService(NO_PROJECT, NO_FILES).edit({ ...opts, source: { doc }, commands: ops, dryRun: true });
}

/** `bpmn layout` on an in-memory document. */
export function layoutDoc(doc: Doc, opts: LayoutDocOptions = {}): Promise<MutationResult> {
  return new RelayoutDiagramService(NO_PROJECT, NO_FILES).relayout({ ...opts, source: { doc }, dryRun: true });
}

/** What `bpmn validate` finds in a document. */
export function checkDoc(doc: Doc, opts: CheckOptions = {}): Promise<CheckResult> {
  return new ValidateDocumentService(NO_PROJECT, NO_FILES).validate({ ...opts, source: { doc } });
}
