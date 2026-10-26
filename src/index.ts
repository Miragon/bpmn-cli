/// <reference path="./types/vendor.d.ts" preserve="true" />
/**
 * `@miragon/bpmn-cli`: the browser-safe core, free of Node builtins; file helpers are in
 * `@miragon/bpmn-cli/node`. The reference above ships the vendor type shims, so a consumer's
 * typecheck with skipLibCheck false resolves them.
 */
import type { Doc } from './domain/document/Doc.js';
import type { ChangeSet } from './domain/document/ChangeSet.js';
import type { EditCommand } from './domain/commands/types.js';
import { ModelCommandService } from './domain/batch/ModelCommandService.js';
import type { CheckResult } from './application/port/in/ValidateDocumentUseCase.js';
import type { MutationResult } from './domain/batch/types.js';
import { StructuralValidator, type ValidateOptions, type ValidationResult } from './domain/validation/StructuralValidator.js';
import { IdConventionsReader, type IdConventions, type IdNamingHelpers } from './domain/document/ids/IdConventionsReader.js';
import { ConventionsTable, type ConventionsView, type Undeclared } from './domain/document/ids/ConventionsTable.js';
import type { BpmnlintRuleSetting, BpmnlintSeverity, BpmnlintConfig, BpmnlintEngine, ResolvedBpmnlintConfig } from './domain/validation/bpmnlint-validator.js';
import type { NamedValidator, ValidatorFinding } from './domain/validation/validators.js';
import type { El, Model } from './domain/document/utils/moddle.js';
import type { LayoutMetrics, LayoutProblem } from './domain/diagram/utils/problems.js';
import type { Warning } from './domain/document/CliError.js';
import { PlatformDetection, type Platform, type PlatformChoice, type PlatformInfo } from './domain/document/vendor/PlatformDetection.js';
import { PLATFORM_PROFILES, type ProfileReport } from './domain/validation/profiles/PlatformProfiles.js';
import { AgentGuide } from './adapters/in/report/AgentGuide.js';
import { KindsReference } from './adapters/in/report/KindsReference.js';
import { TextPreservation, type PreservedText } from './domain/document/xml/TextPreservation.js';
import { BpmnlintConfigResolution } from './domain/validation/BpmnlintConfigResolution.js';
import { BpmnlintValidator, type BpmnlintValidatorOptions } from './domain/validation/BpmnlintValidator.js';
import { DocRenderer } from './domain/views/render/DocRenderer.js';
import type { RenderOptions, RenderResult } from './domain/views/render/types.js';
import type { AroundOptions, AroundView, ElementContext, Implementation } from './domain/views/context.js';
import type { ElementDetail, FindHit, ModelView } from './domain/views/model-view.js';
import type { LayoutView } from './domain/views/layout-view.js';
import { AroundWindow } from './domain/views/AroundWindow.js';
import { ElementContextBuilder } from './domain/views/ElementContextBuilder.js';
import { ElementFacts } from './domain/views/ElementFacts.js';
import { ModelViewBuilder } from './domain/views/ModelViewBuilder.js';
import { ElementDetailBuilder } from './domain/views/ElementDetailBuilder.js';
import { FindElementsService } from './application/service/FindElementsService.js';
import { LayoutViewBuilder } from './domain/views/LayoutViewBuilder.js';
import { AroundText } from './adapters/in/report/AroundText.js';
import { ContextText } from './adapters/in/report/ContextText.js';
import { DetailText } from './adapters/in/report/DetailText.js';
import { LayoutText } from './adapters/in/report/LayoutText.js';
import { MetricsText } from './adapters/in/report/MetricsText.js';
import { ModelViewText } from './adapters/in/report/ModelViewText.js';
import type { MutationReport, MutationReportLike, MutationSummary, ValidationReport } from './adapters/in/report/command-report.js';
import { MutationReportBuilder } from './adapters/in/report/MutationReportBuilder.js';
import { MutationSummaryBuilder } from './adapters/in/report/MutationSummaryBuilder.js';
import { MutationText } from './adapters/in/report/MutationText.js';
import { SummaryText } from './adapters/in/report/SummaryText.js';
import { ValidationReportBuilder } from './adapters/in/report/ValidationReportBuilder.js';
import { ValidationText } from './adapters/in/report/ValidationText.js';
import { WarningLines } from './adapters/in/report/WarningLines.js';
import { advisoryOf } from './adapters/in/report/utils/findings.js';
import { DecisionLinkReader, type DecisionLink } from './domain/document/DecisionLinkReader.js';
import { CommandParser } from './domain/commands/CommandParser.js';
import { ExtensionLister, type ExtensionInfo } from './domain/document/ExtensionLister.js';
import { LayoutAnalysis } from './domain/diagram/di/LayoutAnalysis.js';
import { FullLayout, type LayoutOptions, type LayoutResult } from './domain/diagram/layout/FullLayout.js';
import { DiagramCommandService, type FormatEntry, type FormatResult } from './domain/batch/DiagramCommandService.js';
import { ProblemLocator } from './domain/diagram/di/ProblemLocator.js';
/* the in-memory API: strings in, strings / data out */
export { mutateDoc, layoutDoc, checkDoc, applyToXml, newXml, layoutXml, validateXml, viewXml, showXml, conventionsXml, metricsXml, findXml, extensionsXml, viewDoc, renderShown, type EditOptions, type EditResult, type EditReport, type LayoutXmlOptions, type ShownView, type ValidateXmlOptions, type ViewOptions } from './api.js';
export { type MutationReport, type MutationReportLike, type MutationSummary, type ValidationReport, type WarningReport } from './adapters/in/report/command-report.js';
export { conventionsLines } from './adapters/in/report/utils/mutation-lines.js';
export function mutationReport(result: MutationResult): MutationReport { return new MutationReportBuilder(result).report(); }
export function mutationWarnings(result: MutationResult): Warning[] { return new MutationReportBuilder(result).warnings(); }
export function opWarnings(result: MutationResult): Warning[] { return new MutationReportBuilder(result).opWarnings(); }
export function renderMutation(result: MutationReportLike, opts: { dryRun?: boolean } = {}): string { return new MutationText(result, opts).text(); }
export function mutationSummary(report: MutationReportLike): MutationSummary { return new MutationSummaryBuilder(report).summary(); }
export function renderSummary(summary: MutationSummary, opts: { dryRun?: boolean; advisory?: ReadonlySet<string> } = {}): string { return new SummaryText(summary, opts).text(); }
export function advisoryValidators(report: Pick<MutationReportLike, 'validation'>): Set<string> { return advisoryOf(report.validation.validators); }
export function warningLines(warnings: readonly Warning[], advisory: ReadonlySet<string> = new Set()): string[] { return new WarningLines(advisory).lines(warnings); }
export function validationReport(check: CheckResult): ValidationReport { return new ValidationReportBuilder(check).report(); }
export function renderValidation(report: ValidationReport): string { return new ValidationText(report).text(); }
export { renderFind, renderExtensionList } from './adapters/in/report/utils/view-lines.js';
export { renderProblems } from './adapters/in/report/utils/result-lines.js';
export function renderView(view: ModelView): string { return new ModelViewText(view).text(); }
export function renderDetail(detail: ElementDetail): string { return new DetailText(detail).text(); }
export function renderAround(view: AroundView): string { return new AroundText(view).text(); }
export function renderContext(context: ElementContext): string { return new ContextText(context).text(); }
export function renderLayoutView(view: LayoutView): string { return new LayoutText(view).text(); }
export function renderMetrics(metrics: LayoutMetrics): string { return new MetricsText(metrics).text(); }
export { setLayoutDebug } from './api.js';
export { type DebugSink } from './domain/diagram/layout/LayoutDebug.js';
export { GUIDE_TOPICS } from './adapters/in/report/AgentGuide.js';
export { ERROR_CATALOGUE } from './adapters/in/report/guide.js';
/* reading views of large models: show --around and show <id> --context */
export { AROUND_DEFAULT_DEPTH, type AroundOptions, type AroundView, type AroundNode, type AroundScope, type ElementContext, type ContextRef, type ContextLink, type ContextCatch, type ContextEventSubProcess, type Implementation } from './domain/views/context.js';
export function aroundView(doc: Doc, id: string, opts: AroundOptions = {}): AroundView { return new AroundWindow(doc, id, opts).view(); }
export function elementContext(doc: Doc, id: string): ElementContext { return new ElementContextBuilder(doc, id).build(); }
export function implementationOf(el: El): Implementation | undefined { return new ElementFacts(el).implementation(); }
/* the building blocks */
export { Doc, TARGETS, type DocSource, type NewDocOptions } from './domain/document/Doc.js';
export { CliError, EXIT_CODES, type ErrorCategory, type Warning } from './domain/document/CliError.js';
export { KINDS, parseKind, kindOf, kindLabel } from './domain/document/utils/kinds.js';
export { FORMAT_OP_NAMES, isDiagramCommand } from './domain/commands/utils/op-names.js';
export type {
  EditCommand,
  AddElement,
  ConnectElements,
  SetProperties,
  RemoveElements,
  ChangeElementType,
  MoveElements,
  ReorderElements,
  EditExtensionElements,
  SplitIntoBranches,
  DiagramCommand,
  PlaceShapes,
  AlignShapes,
  ColorElements,
  PlaceLabel,
  RerouteFlow,
  InsertSpace,
  TidyShapes,
} from './domain/commands/types.js';
export { LAYOUT_MODES, type ConventionsReport, type LayoutMode, type LayoutStatus, type MutationOptions, type MutationResult } from './domain/batch/types.js';
export { type CheckOptions, type CheckResult } from './application/port/in/ValidateDocumentUseCase.js';
export { type LayoutDocOptions } from './application/port/in/RelayoutDiagramUseCase.js';
export type { ValidationDelta } from './domain/validation/FindingBaseline.js';
/* text-preserving output, for hosts that serialise models themselves */
export { type PreservedText } from './domain/document/xml/TextPreservation.js';
export function preserveText(original: string, baseline: string, next: string): Promise<PreservedText> { return new TextPreservation(original, baseline, next).result(); }
/* a host's validators, run inside the write transaction and by validate */
export type { NamedValidator, Validator, ValidatorContext, ValidatorFinding, ValidatorFn, ValidatorIssue, ValidatorReport, ValidatorSeverity } from './domain/validation/validators.js';
/* the project's bpmnlint configuration as an advisory validator; bpmnlint itself is injected */
export { BPMNLINT_COVERS, BPMNLINT_VALIDATOR, type BpmnlintValidatorOptions } from './domain/validation/BpmnlintValidator.js';
export type { BpmnlintConfig, BpmnlintEngine, BpmnlintLinter, BpmnlintLinterClass, BpmnlintReport, BpmnlintResolver, BpmnlintRule, BpmnlintRuleSetting, BpmnlintSeverity, BpmnlintUnavailable, ResolvedBpmnlintConfig } from './domain/validation/bpmnlint-validator.js';
/** The advisory validator of a resolved bpmnlint configuration. */
export function bpmnlintValidator(engine: BpmnlintEngine, resolved: ResolvedBpmnlintConfig, opts: BpmnlintValidatorOptions = {}): NamedValidator { return new BpmnlintValidator(engine, resolved, opts).named(); }
/**
 * The effective bpmnlint configuration; `opts.moddleExtensions` holds the descriptors the host
 * resolved for the module paths of `config.moddleExtensions`.
 */
export async function resolveBpmnlintConfig(engine: BpmnlintEngine, config: BpmnlintConfig, opts: { moddleExtensions?: Record<string, object> } = {}): Promise<ResolvedBpmnlintConfig> { return new BpmnlintConfigResolution(engine, config, opts).resolve(); }
/* declared id conventions: what element-id-naming in the .bpmnlintrc says about new ids */
export { renderConventions } from './domain/document/utils/conventions-text.js';
export { ID_NAMING_RULE, type IdConventions, type IdNamingHelpers, type QualifierMode } from './domain/document/ids/IdConventionsReader.js';
export { type ConventionsView, type ConventionsRow, type Undeclared } from './domain/document/ids/ConventionsTable.js';

/**
 * The id conventions element-id-naming declares, with a W_CONFIG_IGNORED note for each value
 * new ids cannot follow; `conventions` is undefined where nothing is declared.
 */
export function idConventionsFromLint(setting: BpmnlintRuleSetting | undefined, naming: IdNamingHelpers, opts: { source?: string } = {}): { conventions?: IdConventions; notes: ValidatorFinding[] } {
  return new IdConventionsReader(naming, opts.source).read(setting);
}

/** The id conventions new ids follow in a document (undefined: a new file), one row per pattern. */
export function conventionsView(
  doc: Doc | undefined,
  conventions: IdConventions | undefined,
  opts: { file?: string; severity?: BpmnlintSeverity; notes?: ValidatorFinding[]; where?: string; undeclared?: Undeclared } = {},
): ConventionsView {
  return new ConventionsTable(doc, conventions).view(opts);
}

export type { DecisionLink } from './domain/document/DecisionLinkReader.js';

/** The decision link of a business rule task in any spelling. */
export function decisionLinkOf(el: El, doc?: Doc): DecisionLink | undefined {
  return new DecisionLinkReader(doc).linkOf(el);
}

export { ChangeSet, type Change } from './domain/document/ChangeSet.js';
export type { ValidateOptions, ValidationResult } from './domain/validation/StructuralValidator.js';
/** Structural validation and lint of a document, with the platform profile on request. */
export function validateDoc(doc: Doc, opts: ValidateOptions = {}): ValidationResult { return new StructuralValidator(doc).validate(opts); }
/* the platform profile: Camunda 7 / 8 rules, loaded on demand */
export { PLATFORM_CHOICES, type Platform, type PlatformChoice, type PlatformInfo } from './domain/document/vendor/PlatformDetection.js';
export type { PlatformSummary, ProfileReport } from './domain/validation/profiles/PlatformProfiles.js';
export type { ProfileFinding, Severity } from './domain/document/utils/finding.js';
export type { ExtensionInfo } from './domain/document/ExtensionLister.js';
export { type ModelView, type ElementDetail, type DetailMessageFlow, type DetailData, type FindHit } from './domain/views/model-view.js';
export function buildView(doc: Doc): ModelView { return new ModelViewBuilder(doc).build(); }
export function elementDetail(doc: Doc, el: El): ElementDetail { return new ElementDetailBuilder(doc, el).build(); }
export function findElements(doc: Doc, text: string, kind?: string): FindHit[] { return new FindElementsService().find({ doc, text, ...(kind !== undefined ? { kind } : {}) }); }
export function scopeView(doc: Doc, view: ModelView, scopeId: string): ModelView { return new ModelViewBuilder(doc).scope(view, scopeId); }
export { OPS_SCHEMA } from './domain/commands/OpsSchemaBuilder.js';
/* the diagram API: read-only views of a drawing and the format operations */
export { diffProblems, metricsDelta, KEYS as METRIC_KEYS, WEIGHTS as METRIC_WEIGHTS, type LayoutMetrics, type LayoutProblem, type ProblemLocation, type MetricKey, type MetricsDelta, type MetricsSummary } from './domain/diagram/utils/problems.js';
export { type LayoutView, type LayoutDiagram, type LayoutGroup, type LayoutColor, type LayoutLabel } from './domain/views/layout-view.js';
export function layoutView(defs: El): LayoutView { return new LayoutViewBuilder(defs).build(); }
export type { FormatResult, FormatEntry } from './domain/batch/DiagramCommandService.js';
export { SWATCHES, type SwatchName } from './domain/diagram/utils/colors.js';
/* the drawing as SVG; PNG: renderPng in @miragon/bpmn-cli/node */
export { RENDER_MAX_SIZE, MIN_LABEL_SCALE, HALO_COLORS, type RenderOptions, type RenderResult, type RenderHighlight, type RenderProblem, type RenderTile } from './domain/views/render/types.js';
export { changeHighlight } from './adapters/in/report/utils/highlight.js';
/** `bpmn render --format svg`: one plane of the document as SVG. */
export function renderSvg(xml: string, opts: RenderOptions = {}): Promise<RenderResult> { return DocRenderer.renderXml(xml, opts); }
/** One plane of a parsed document as SVG (no layout). */
export function renderDocSvg(doc: Doc, opts: RenderOptions = {}): RenderResult { return new DocRenderer(doc, opts).render(); }


/** The extension elements of an element, in order. */
export function listExtensions(el: El): ExtensionInfo[] {
  return new ExtensionLister().list(el);
}

/** `ext list`: the element's own extension elements, then those of its nested elements. */
export function listAllExtensions(el: El): ExtensionInfo[] {
  return new ExtensionLister().listAll(el);
}

/** Runs one op on its own. */
export function runOp(doc: Doc, op: EditCommand): ChangeSet {
  return new ModelCommandService(doc).runOp(op);
}

/** Runs a batch and returns what changed. */
export function runOps(doc: Doc, ops: EditCommand[]): ChangeSet {
  return new ModelCommandService(doc).runBatch(ops).changes;
}

/** Validates the ops JSON (an array or `{ ops }`); a usage error names the op index. */
export function parseOps(input: unknown): EditCommand[] {
  return new CommandParser().parse(input);
}

/** Throws E_IMPORT_LOSSY when bpmn-moddle dropped content on import, unless `force`. */
export function assertLossless(doc: Doc, opts: { force?: boolean } = {}): void {
  doc.assertLossless(opts);
}

/**
 * Loads the engine rules of `platform` (cached), needed before the synchronous runProfile and
 * validateDoc; the async API loads them itself. A failed load (E_PROFILE_LOAD) is retried later.
 */
export function loadProfile(platform: Platform): Promise<void> {
  return PLATFORM_PROFILES.load(platform);
}

/** Loads the engine rules of several platforms (default: all). */
export function loadProfiles(platforms?: readonly Exclude<Platform, 'none'>[]): Promise<void> {
  return PLATFORM_PROFILES.loadAll(platforms);
}

/** Runs the profile of the document's platform (or `choice`); its rules must be loaded. */
export function runProfile(doc: Doc, choice?: PlatformChoice): ProfileReport {
  return PLATFORM_PROFILES.run(doc, choice);
}

/**
 * Detects the target engine: modeler:executionPlatform, else the vendor namespace the content
 * uses, else a declared one.
 */
export function detectPlatform(doc: Doc): PlatformInfo {
  return PlatformDetection.of(doc).info();
}

/** `bpmn guide`: the agent cheat sheet. */
export function guideText(): string {
  return new AgentGuide().text();
}

/** `bpmn guide --short`: the essentials of the guide in at most 5 KB. */
export function guideShort(): string {
  return new AgentGuide().short();
}

/** `bpmn guide <topic>`: the sections of the full guide a topic names. */
export function guideTopic(topic: string): string {
  return new AgentGuide().topic(topic);
}

/** `bpmn kinds`: kinds, triggers, set keys, placement grammar and the error catalogue. */
export function kindsText(): string {
  return new KindsReference().text();
}

/** `bpmn kinds --json`: the same as one object, plus the ops schema and example. */
export function kindsJson(): Record<string, unknown> {
  return new KindsReference().json();
}

/** Resolves `--section a,b`, ignoring case and dashes (set-keys = setKeys). */
export function kindsSections(spec: string): string[] {
  return new KindsReference().sections(spec);
}

/** `bpmn kinds --section <names>` as text. */
export function kindsSectionText(sections: string[]): string {
  return new KindsReference().sectionText(sections);
}

/** `bpmn kinds --section <names> --json`: only those keys of kindsJson(). */
export function kindsSectionJson(sections: string[]): Record<string, unknown> {
  return new KindsReference().sectionJson(sections);
}

/** The layout problems of every diagram; `importWarnings` count as one `failed` problem. */
export function layoutProblems(defs: El, opts: { importWarnings?: number } = {}): LayoutMetrics {
  return LayoutAnalysis.of(defs, opts);
}

/** Parses `xml` and measures it (import warnings count as `failed`). */
export function layoutProblemsOfXml(xml: string): Promise<LayoutMetrics> {
  return LayoutAnalysis.ofXml(xml);
}

/** The problems with where each shows on its plane. */
export function locateProblems(defs: El, problems: readonly LayoutProblem[]): LayoutProblem[] {
  return new ProblemLocator(defs).locate(problems);
}

/**
 * Runs the format ops of a batch on the drawing of `doc`; with `asFile` (a format-only batch)
 * the first op's refusal may name a runnable command.
 */
export function runFormatOps(doc: Doc, entries: readonly FormatEntry[], asFile = false): FormatResult[] {
  return new DiagramCommandService(doc).run(entries, asFile);
}

/**
 * Lays out the model. Its in-memory DI is replaced by the hint diagram as a side effect:
 * treat the returned XML as the truth and re-parse it if you need DI.
 */
export function layoutModel(model: Model, opts: LayoutOptions = {}): Promise<LayoutResult> {
  return new FullLayout(model, opts).run();
}
