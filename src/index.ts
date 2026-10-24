/// <reference path="./types/vendor.d.ts" preserve="true" />
/**
 * `@miragon/bpmn-cli`: the browser-safe core. Nothing reachable from here
 * imports a Node builtin or reads `process`, `Buffer` or the file system
 * (tools/iso/check.mjs and test/isomorphic.test.ts enforce that); the file
 * helpers are in `@miragon/bpmn-cli/node` (src/node/index.ts).
 *
 * The reference above ships the type shims of bpmn-moddle / bpmn-auto-layout
 * (copied to dist/types by `npm run build`), so a consumer's strict
 * typecheck (skipLibCheck false) resolves them.
 */
import type { Doc } from './model/Doc.js';
import type { ChangeSet } from './model/ChangeSet.js';
import type { Op } from './ops/types.js';
import { OpRunner } from './ops/OpRunner.js';
import type { CheckOptions, CheckResult, LayoutDocOptions, MutationOptions, MutationResult } from './pipeline/index.js';
import { EditTransaction } from './pipeline/EditTransaction.js';
import { Relayout } from './pipeline/Relayout.js';
import { DocCheck } from './pipeline/DocCheck.js';
import { IdConventionsReader, type IdConventions, type IdNamingHelpers } from './ids/IdConventionsReader.js';
import { ConventionsTable, type ConventionsView, type Undeclared } from './ids/ConventionsTable.js';
import type { BpmnlintRuleSetting, BpmnlintSeverity, BpmnlintConfig, BpmnlintEngine, ResolvedBpmnlintConfig } from './validate/bpmnlint-validator.js';
import type { NamedValidator, ValidatorFinding } from './validate/validators.js';
import type { El } from './model/utils/moddle.js';
import type { LayoutMetrics } from './diagram/metrics.js';
import type { Warning } from './shared/CliError.js';
import { PlatformDetection, type Platform, type PlatformChoice, type PlatformInfo } from './platform/PlatformDetection.js';
import { PLATFORM_PROFILES, type ProfileReport } from './platform/profiles/PlatformProfiles.js';
import { AgentGuide } from './report/AgentGuide.js';
import { KindsReference } from './report/KindsReference.js';
import { TextPreservation, type PreservedText } from './xml/TextPreservation.js';
import { BpmnlintConfigResolution } from './validate/BpmnlintConfigResolution.js';
import { BpmnlintValidator, type BpmnlintValidatorOptions } from './validate/BpmnlintValidator.js';
import { DocRenderer } from './render/DocRenderer.js';
import type { RenderOptions, RenderResult } from './render/types.js';
import type { AroundOptions, AroundView, ElementContext, Implementation } from './query/context.js';
import type { ElementDetail, FindHit, ModelView } from './query/model-view.js';
import type { LayoutView } from './query/layout-view.js';
import { AroundWindow } from './query/AroundWindow.js';
import { ElementContextBuilder } from './query/ElementContextBuilder.js';
import { ElementFacts } from './query/ElementFacts.js';
import { ModelViewBuilder } from './query/ModelViewBuilder.js';
import { ElementDetailBuilder } from './query/ElementDetailBuilder.js';
import { ElementFinder } from './query/ElementFinder.js';
import { LayoutViewBuilder } from './query/LayoutViewBuilder.js';
import { AroundText } from './report/AroundText.js';
import { ContextText } from './report/ContextText.js';
import { DetailText } from './report/DetailText.js';
import { LayoutText } from './report/LayoutText.js';
import { MetricsText } from './report/MetricsText.js';
import { ModelViewText } from './report/ModelViewText.js';
import type { MutationReport, MutationReportLike, MutationSummary, ValidationReport } from './report/command-report.js';
import { MutationReportBuilder } from './report/MutationReportBuilder.js';
import { MutationSummaryBuilder } from './report/MutationSummaryBuilder.js';
import { MutationText } from './report/MutationText.js';
import { SummaryText } from './report/SummaryText.js';
import { ValidationReportBuilder } from './report/ValidationReportBuilder.js';
import { ValidationText } from './report/ValidationText.js';
import { WarningLines } from './report/WarningLines.js';
import { advisoryOf } from './report/utils/findings.js';
import { DecisionLinkReader, type DecisionLink } from './ops/DecisionLinkReader.js';
import { OpsParser } from './ops/OpsParser.js';
import { ExtensionLister, type ExtensionInfo } from './ops/ExtensionLister.js';
/* the in-memory API: strings in, strings / data out (docs/library.md) */
export { applyToXml, newXml, layoutXml, validateXml, viewXml, showXml, conventionsXml, metricsXml, findXml, extensionsXml, viewDoc, renderShown, type EditOptions, type EditResult, type EditReport, type LayoutXmlOptions, type ShownView, type ValidateXmlOptions, type ViewOptions } from './api.js';
export { type MutationReport, type MutationReportLike, type MutationSummary, type ValidationReport, type WarningReport } from './report/command-report.js';
export { conventionsLines } from './report/utils/mutation-lines.js';
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
export { renderFind, renderExtensionList } from './report/utils/view-lines.js';
export { renderProblems } from './report/utils/result-lines.js';
export function renderView(view: ModelView): string { return new ModelViewText(view).text(); }
export function renderDetail(detail: ElementDetail): string { return new DetailText(detail).text(); }
export function renderAround(view: AroundView): string { return new AroundText(view).text(); }
export function renderContext(c: ElementContext): string { return new ContextText(c).text(); }
export function renderLayoutView(view: LayoutView): string { return new LayoutText(view).text(); }
export function renderMetrics(m: LayoutMetrics): string { return new MetricsText(m).text(); }
export { setLayoutDebug } from './api.js';
export { type DebugSink } from './shared/LayoutDebug.js';
export { GUIDE_TOPICS } from './report/AgentGuide.js';
export { ERROR_CATALOGUE } from './report/guide.js';
/* the reading views of large models: the neighbourhood of an element (show --around) and an element in its context (show <id> --context) */
export { AROUND_DEFAULT_DEPTH, type AroundOptions, type AroundView, type AroundNode, type AroundScope, type ElementContext, type ContextRef, type ContextLink, type ContextCatch, type ContextEventSubProcess, type Implementation } from './query/context.js';
export function aroundView(doc: Doc, id: string, opts: AroundOptions = {}): AroundView { return new AroundWindow(doc, id, opts).view(); }
export function elementContext(doc: Doc, id: string): ElementContext { return new ElementContextBuilder(doc, id).build(); }
export function implementationOf(el: El): Implementation | undefined { return new ElementFacts(el).implementation(); }
/* the building blocks */
export { Doc, TARGETS, type DocSource, type NewDocOptions } from './model/Doc.js';
export { CliError, EXIT_CODES, type ErrorCategory, type Warning } from './shared/CliError.js';
export { KINDS, parseKind, kindOf, kindLabel } from './model/utils/kinds.js';
export { layoutModel } from './layout/index.js';
export { FORMAT_OP_NAMES, isFormatOp } from './ops/utils/op-names.js';
export type {
  Op,
  AddOp,
  ConnectOp,
  SetOp,
  RemoveOp,
  RetypeOp,
  MoveOp,
  OrderOp,
  ExtOp,
  SplitOp,
  FormatOp,
  PlaceOp,
  AlignOp,
  ColorOp,
  LabelOp,
  RouteOp,
  SpaceOp,
  TidyOp,
} from './ops/types.js';
export { LAYOUT_MODES, type CheckOptions, type CheckResult, type ConventionsReport, type LayoutDocOptions, type LayoutMode, type LayoutStatus, type MutationOptions, type MutationResult } from './pipeline/index.js';
export type { ValidationDelta } from './validate/FindingBaseline.js';
/* text-preserving output: what mutateDoc uses to keep a file's formatting (for hosts that serialise models themselves) */
export { type PreservedText } from './xml/TextPreservation.js';
export function preserveText(original: string, baseline: string, next: string): Promise<PreservedText> { return new TextPreservation(original, baseline, next).result(); }
/* a host's validators, run inside the write transaction (MutationOptions.validators) and by validate (CheckOptions.validators) */
export type { NamedValidator, Validator, ValidatorContext, ValidatorFinding, ValidatorFn, ValidatorIssue, ValidatorReport, ValidatorSeverity } from './validate/validators.js';
/* the project's bpmnlint configuration as an advisory validator; bpmnlint itself is injected (@miragon/bpmn-cli/node loads it) */
export { BPMNLINT_COVERS, BPMNLINT_VALIDATOR, type BpmnlintValidatorOptions } from './validate/BpmnlintValidator.js';
export type { BpmnlintConfig, BpmnlintEngine, BpmnlintLinter, BpmnlintLinterClass, BpmnlintReport, BpmnlintResolver, BpmnlintRule, BpmnlintRuleSetting, BpmnlintSeverity, BpmnlintUnavailable, ResolvedBpmnlintConfig } from './validate/bpmnlint-validator.js';
/** The NamedValidator of a resolved configuration (BpmnlintValidator). */
export function bpmnlintValidator(engine: BpmnlintEngine, resolved: ResolvedBpmnlintConfig, opts: BpmnlintValidatorOptions = {}): NamedValidator { return new BpmnlintValidator(engine, resolved, opts).named(); }
/** The effective configuration (BpmnlintConfigResolution). `opts.moddleExtensions`: descriptors the host resolved for the module paths of `config.moddleExtensions`. */
export async function resolveBpmnlintConfig(engine: BpmnlintEngine, config: BpmnlintConfig, opts: { moddleExtensions?: Record<string, object> } = {}): Promise<ResolvedBpmnlintConfig> { return new BpmnlintConfigResolution(engine, config, opts).resolve(); }
/* declared id conventions: what element-id-naming of the project's .bpmnlintrc says about new ids (its naming helpers injected; @miragon/bpmn-cli/node reads the .bpmnlintrc) */
export { renderConventions } from './ids/utils/conventions-text.js';
export { ID_NAMING_RULE, type IdConventions, type IdNamingHelpers, type QualifierMode } from './ids/IdConventionsReader.js';
export { type ConventionsView, type ConventionsRow, type Undeclared } from './ids/ConventionsTable.js';

/**
 * The id conventions element-id-naming declares with its effective setting
 * (src/ids/IdConventionsReader.ts), and a W_CONFIG_IGNORED note for each
 * value new ids cannot follow; `source` names the .bpmnlintrc in the notes
 * and the results (default `.bpmnlintrc`). `conventions` is undefined where
 * nothing is declared (no setting, severity off, every prefix switched off).
 */
export function idConventionsFromLint(setting: BpmnlintRuleSetting | undefined, naming: IdNamingHelpers, opts: { source?: string } = {}): { conventions?: IdConventions; notes: ValidatorFinding[] } {
  return new IdConventionsReader(naming, opts.source).read(setting);
}

/**
 * The conventions new ids follow in a document (undefined: a new file),
 * with `conventions` declared over its own style (IdStyle.infer): one row
 * per pattern and source, the kinds that follow it; `opts`: the file, its
 * rule setting, the notes, where the .bpmnlintrc is and why it declares
 * none, as the node layer found them (src/ids/ConventionsTable.ts).
 */
export function conventionsView(
  doc: Doc | undefined,
  conventions: IdConventions | undefined,
  opts: { file?: string; severity?: BpmnlintSeverity; notes?: ValidatorFinding[]; where?: string; undeclared?: Undeclared } = {},
): ConventionsView {
  return new ConventionsTable(doc, conventions).view(opts);
}

export type { DecisionLink } from './ops/DecisionLinkReader.js';

/** The decision link of a business rule task in any spelling (undefined for other elements or without one). */
export function decisionLinkOf(el: El, doc?: Doc): DecisionLink | undefined {
  return new DecisionLinkReader(doc).linkOf(el);
}

export { ChangeSet, type Change } from './model/ChangeSet.js';
export { validateDoc, type ValidateOptions, type ValidationResult } from './validate/structural.js';
/* the platform profile (Camunda 7 / 8 rules, loaded on demand; validate --platform) */
export { PLATFORM_CHOICES, type Platform, type PlatformChoice, type PlatformInfo } from './platform/PlatformDetection.js';
export type { PlatformSummary, ProfileReport } from './platform/profiles/PlatformProfiles.js';
export type { ProfileFinding, Severity } from './platform/utils/finding.js';
export type { ExtensionInfo } from './ops/ExtensionLister.js';
export { type ModelView, type ElementDetail, type DetailMessageFlow, type DetailData, type FindHit } from './query/model-view.js';
export function buildView(doc: Doc): ModelView { return new ModelViewBuilder(doc).build(); }
export function elementDetail(doc: Doc, el: El): ElementDetail { return new ElementDetailBuilder(doc, el).build(); }
export function findElements(doc: Doc, text: string, kind?: string): FindHit[] { return new ElementFinder(doc).find(text, kind); }
export function scopeView(doc: Doc, view: ModelView, scopeId: string): ModelView { return new ModelViewBuilder(doc).scope(view, scopeId); }
export { OPS_SCHEMA } from './ops/OpsSchemaBuilder.js';
/* the diagram API: read-only views of a drawing and the format operations */
export { layoutProblems, layoutProblemsOfXml, locateProblems, diffProblems, metricsDelta, KEYS as METRIC_KEYS, WEIGHTS as METRIC_WEIGHTS, type LayoutMetrics, type LayoutProblem, type ProblemLocation, type MetricKey, type MetricsDelta, type MetricsSummary } from './diagram/metrics.js';
export { type LayoutView, type LayoutDiagram, type LayoutGroup, type LayoutColor, type LayoutLabel } from './query/layout-view.js';
export function layoutView(defs: El): LayoutView { return new LayoutViewBuilder(defs).build(); }
export { runFormatOps, type FormatResult, type FormatEntry } from './format/index.js';
export { SWATCHES, type SwatchName } from './diagram/write.js';
/* the drawing as an image: one diagram plane as SVG (`bpmn render --format svg`; PNG: renderPng in @miragon/bpmn-cli/node) */
export { RENDER_MAX_SIZE, MIN_LABEL_SCALE, HALO_COLORS, type RenderOptions, type RenderResult, type RenderHighlight, type RenderProblem, type RenderTile } from './render/types.js';
export { changeHighlight } from './render/utils/highlight.js';
/** `bpmn render --format svg`: one plane of the document as SVG (see the contract in src/render/DocRenderer.ts). */
export function renderSvg(xml: string, opts: RenderOptions = {}): Promise<RenderResult> { return DocRenderer.renderXml(xml, opts); }
/** One plane of a parsed document as SVG (no layout). */
export function renderDocSvg(doc: Doc, opts: RenderOptions = {}): RenderResult { return new DocRenderer(doc, opts).render(); }


/** The extension elements of an element, in order. */
export function listExtensions(el: El): ExtensionInfo[] {
  return new ExtensionLister().list(el);
}

/** `ext list`: the element's own extension elements, then those of its nested elements, each with its slot. */
export function listAllExtensions(el: El): ExtensionInfo[] {
  return new ExtensionLister().listAll(el);
}

/** Runs one op on its own (src/ops/OpRunner.ts). */
export function runOp(doc: Doc, op: Op): ChangeSet {
  return new OpRunner(doc).runOp(op);
}

/** Runs a batch (OpRunner.runBatch) and returns what changed. */
export function runOps(doc: Doc, ops: Op[]): ChangeSet {
  return new OpRunner(doc).runBatch(ops).changes;
}

/**
 * Validates the ops JSON (an array or `{ ops: [...] }`) and returns typed
 * ops. Throws a usage error (exit 1) naming the op index for every problem.
 */
export function parseOps(input: unknown): Op[] {
  return new OpsParser().parse(input);
}

/** Applies ops to an in-memory document (src/pipeline/EditTransaction.ts). */
export function mutateDoc(doc: Doc, ops: Op[], opts: MutationOptions = {}): Promise<MutationResult> {
  return new EditTransaction(doc, ops, opts).run();
}

/** `bpmn layout` on an in-memory document (src/pipeline/Relayout.ts). */
export function layoutDoc(doc: Doc, opts: LayoutDocOptions = {}): Promise<MutationResult> {
  return new Relayout(opts).run(doc);
}

/** What `bpmn validate` finds in a document (src/pipeline/DocCheck.ts). */
export function checkDoc(doc: Doc, opts: CheckOptions = {}): Promise<CheckResult> {
  return new DocCheck(opts).run(doc);
}

/** Throws E_IMPORT_LOSSY when bpmn-moddle dropped content while importing the document (unless force; Doc.assertLossless). */
export function assertLossless(doc: Doc, opts: { force?: boolean } = {}): void {
  doc.assertLossless(opts);
}

/**
 * Loads the engine rules of `platform` (cached; `'none'` resolves at once).
 * The async API loads them itself; call it before the synchronous building
 * blocks (runProfile, validateDoc(doc, { platform })), or to prefetch the
 * chunk when a host opens a Camunda 7 / 8 file. Rejects with E_PROFILE_LOAD
 * (category io) when the module cannot be loaded; a later call tries again.
 */
export function loadProfile(platform: Platform): Promise<void> {
  return PLATFORM_PROFILES.load(platform);
}

/** Loads the engine rules of several platforms (default: all), e.g. once before synchronous runProfile / validateDoc calls. */
export function loadProfiles(platforms?: readonly Exclude<Platform, 'none'>[]): Promise<void> {
  return PLATFORM_PROFILES.loadAll(platforms);
}

/**
 * Runs the profile of the document's platform (or of `choice`). Throws
 * E_PROFILE_NOT_LOADED when that platform's rules are not loaded
 * (loadProfile; the async API loads them itself).
 */
export function runProfile(doc: Doc, choice?: PlatformChoice): ProfileReport {
  return PLATFORM_PROFILES.run(doc, choice);
}

/** Detects the target engine of a document: modeler:executionPlatform, else the vendor namespace its content uses, else a declared one. */
export function detectPlatform(doc: Doc): PlatformInfo {
  return PlatformDetection.of(doc).info();
}

/** `bpmn guide`: the agent cheat sheet. */
export function guideText(): string {
  return new AgentGuide().text();
}

/** `bpmn guide --short`: contract, reading, changing, ops keys, placement and the top errors in at most 5 KB. */
export function guideShort(): string {
  return new AgentGuide().short();
}

/** `bpmn guide <topic>`: the sections of the full guide a topic names; E_USAGE with the topics for an unknown one. */
export function guideTopic(topic: string): string {
  return new AgentGuide().topic(topic);
}

/** `bpmn kinds`: kinds, triggers, set keys, placement grammar and the error catalogue as text. */
export function kindsText(): string {
  return new KindsReference().text();
}

/** `bpmn kinds --json`: the same as one object, plus the ops schema and example. */
export function kindsJson(): Record<string, unknown> {
  return new KindsReference().json();
}

/** Resolves `--section a,b` (case and dashes ignored: set-keys = setKeys); E_USAGE with the names for an unknown one. */
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
