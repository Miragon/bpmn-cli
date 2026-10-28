/// <reference path="./types/vendor.d.ts" preserve="true" />
/**
 * `@miragon/bpmn-cli`: the browser-safe core, free of Node builtins; file helpers are in
 * `@miragon/bpmn-cli/node`. The reference above ships the vendor type shims, so a consumer's
 * typecheck with skipLibCheck false resolves them.
 */
import type { Doc } from './domain/document/Doc.js';
import type { ChangeSet } from './domain/document/ChangeSet.js';
import type { EditCommand } from './domain/commands/types.js';
import type { CheckResult } from './application/port/in/ValidateDocumentUseCase.js';
import type { MutationResult } from './domain/batch/types.js';
import type { ValidateOptions, ValidationResult } from './domain/validation/StructuralValidator.js';
import type { IdConventions } from './domain/document/ids/IdConventions.js';
import type { ConventionsView, Undeclared } from './domain/document/ids/ConventionsTable.js';
import type { BpmnlintRuleSetting, BpmnlintSeverity, BpmnlintConfig, BpmnlintEngine, ResolvedBpmnlintConfig } from './adapters/out/bpmnlint/bpmnlint-contract.js';
import type { NamedValidator, ValidatorFinding } from './domain/validation/validators.js';
import type { El, Model } from './domain/document/utils/moddle.js';
import type { LayoutMetrics, LayoutProblem } from './domain/diagram/utils/problems.js';
import type { Warning } from './domain/document/BpmnError.js';
import type { Platform, PlatformChoice, PlatformInfo } from './domain/document/vendor/PlatformDetection.js';
import type { ProfileReport } from './domain/validation/profiles/PlatformProfiles.js';
import { AgentGuide } from './adapters/in/report/AgentGuide.js';
import { KindsReference } from './adapters/in/report/KindsReference.js';
import type { PreservedText } from './domain/document/xml/TextPreservation.js';
import { BpmnlintValidator, type BpmnlintValidatorOptions } from './adapters/out/bpmnlint/BpmnlintValidator.js';
import { BpmnlintConfigResolution } from './adapters/out/bpmnlint/BpmnlintConfigResolution.js';
import { IdConventionsReader, type IdNamingHelpers } from './adapters/out/bpmnlint/IdConventionsReader.js';
import type { RenderOptions, RenderResult } from './domain/views/render/types.js';
import type { AroundOptions, AroundView, ElementContext, Implementation } from './domain/views/around-view.js';
import type { ElementDetail, FindHit, ModelView } from './domain/views/model-view.js';
import type { LayoutView } from './domain/views/layout-view.js';
import { FindElementsService } from './application/service/FindElementsService.js';
import { ShowModelService } from './application/service/ShowModelService.js';
import { ValidateDocumentService } from './application/service/ValidateDocumentService.js';
import { ShowConventionsService } from './application/service/ShowConventionsService.js';
import { RunCommandsService } from './application/service/RunCommandsService.js';
import { AnalyzeLayoutService } from './application/service/AnalyzeLayoutService.js';
import { RenderSvgService } from './application/service/RenderSvgService.js';
import { EditDocumentService } from './application/service/EditDocumentService.js';
import { RelayoutDiagramService } from './application/service/RelayoutDiagramService.js';
import { NoProjectSettings } from './adapters/out/memory/NoProjectSettings.js';
import { NoDocumentFiles } from './adapters/out/memory/NoDocumentFiles.js';
import { DetailText } from './adapters/in/report/DetailText.js';
import { LayoutText } from './adapters/in/report/LayoutText.js';
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
import type { ExtensionInfo } from './domain/document/ExtensionLister.js';
import type { LayoutOptions, LayoutResult } from './domain/diagram/layout/FullLayout.js';
const NO_PROJECT = new NoProjectSettings();
const NO_FILES = new NoDocumentFiles();
/* the in-memory API: strings in, strings / data out */
export { mutateDoc, layoutDoc, checkDoc, applyToXml, newXml, layoutXml, validateXml, viewXml, showXml, conventionsXml, metricsXml, findXml, extensionsXml, type EditOptions, type EditResult, type EditReport, type LayoutXmlOptions, type ShownView, type ValidateXmlOptions, type ViewOptions } from './api.js';
export { type MutationReport, type MutationReportLike, type MutationSummary, type ValidationReport, type WarningReport } from './adapters/in/report/command-report.js';
export { conventionsLines } from './adapters/in/report/utils/mutation-lines.js';
export function mutationReport(result: MutationResult): MutationReport { return new MutationReportBuilder(result).report(); }
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
export function renderLayoutView(view: LayoutView): string { return new LayoutText(view).text(); }
export { setLayoutDebug } from './api.js';
export { type DebugSink } from './domain/diagram/layout/LayoutDebug.js';
export { GUIDE_TOPICS } from './adapters/in/report/AgentGuide.js';
export { ERROR_CATALOGUE } from './adapters/in/report/guide.js';
/* reading views of large models: show --around and show <id> --context */
export { AROUND_DEFAULT_DEPTH, type AroundOptions, type AroundView, type AroundNode, type AroundScope, type ElementContext, type ContextRef, type ContextLink, type ContextCatch, type ContextEventSubProcess, type Implementation } from './domain/views/around-view.js';
export function aroundView(doc: Doc, id: string, opts: AroundOptions = {}): AroundView { return new ShowModelService().aroundView({ ...opts, doc, id }); }
export function elementContext(doc: Doc, id: string): ElementContext { return new ShowModelService().elementContext({ doc, id }); }
export function implementationOf(el: El): Implementation | undefined { return new ShowModelService().implementation({ element: el }); }
/* the building blocks */
export { Doc, type DocSource, type NewDocOptions } from './domain/document/Doc.js';
export { BpmnError, EXIT_CODES, type ErrorCategory, type Warning } from './domain/document/BpmnError.js';
/** @deprecated renamed to BpmnError */
export { BpmnError as CliError } from './domain/document/BpmnError.js';
export { KINDS, parseKind, kindOf, kindLabel } from './domain/document/Kinds.js';
export { DIAGRAM_COMMAND_NAMES as FORMAT_OP_NAMES, isDiagramCommand } from './domain/commands/utils/command-names.js';
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
export { type ConventionsReport, type MutationOptions, type MutationResult } from './domain/batch/types.js';
export { LAYOUT_MODES, type LayoutMode, type LayoutStatus } from './domain/diagram/types.js';
export { type CheckOptions, type CheckResult } from './application/port/in/ValidateDocumentUseCase.js';
export { type LayoutDocOptions } from './application/port/in/RelayoutDiagramUseCase.js';
export type { ValidationDelta } from './domain/validation/FindingBaseline.js';
/* text-preserving output, for hosts that serialise models themselves */
export { type PreservedText } from './domain/document/xml/TextPreservation.js';
export function preserveText(original: string, baseline: string, next: string): Promise<PreservedText> { return new EditDocumentService(NO_PROJECT, NO_FILES).preserveText({ original, baseline, next }); }
/* a host's validators, run inside the write transaction and by validate */
export type { NamedValidator, Validator, ValidatorContext, ValidatorFinding, ValidatorFn, ValidatorIssue, ValidatorReport, ValidatorSeverity } from './domain/validation/validators.js';
/* the project's bpmnlint configuration as an advisory validator; bpmnlint itself is injected */
export { BPMNLINT_COVERS, BPMNLINT_VALIDATOR, type BpmnlintValidatorOptions } from './adapters/out/bpmnlint/BpmnlintValidator.js';
export type { BpmnlintConfig, BpmnlintEngine, BpmnlintLinter, BpmnlintLinterClass, BpmnlintReport, BpmnlintResolver, BpmnlintRule, BpmnlintRuleSetting, BpmnlintSeverity, BpmnlintUnavailable, ResolvedBpmnlintConfig } from './adapters/out/bpmnlint/bpmnlint-contract.js';
/** The advisory validator of a resolved bpmnlint configuration. */
export function bpmnlintValidator(engine: BpmnlintEngine, resolved: ResolvedBpmnlintConfig, opts: BpmnlintValidatorOptions = {}): NamedValidator { return new BpmnlintValidator(engine, resolved, opts).named(); }
/**
 * The effective bpmnlint configuration; `opts.moddleExtensions` holds the descriptors the host
 * resolved for the module paths of `config.moddleExtensions`.
 */
export async function resolveBpmnlintConfig(engine: BpmnlintEngine, config: BpmnlintConfig, opts: { moddleExtensions?: Record<string, object> } = {}): Promise<ResolvedBpmnlintConfig> { return new BpmnlintConfigResolution(engine, config, opts).resolve(); }
/* declared id conventions: what element-id-naming in the .bpmnlintrc says about new ids */
export { renderConventions } from './adapters/in/report/utils/conventions-text.js';
export type { IdConventions, QualifierMode } from './domain/document/ids/IdConventions.js';
export { ID_NAMING_RULE, type IdNamingHelpers } from './adapters/out/bpmnlint/IdConventionsReader.js';
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
  return new ShowConventionsService(NO_PROJECT).view({ ...opts, ...(doc !== undefined ? { doc } : {}), ...(conventions !== undefined ? { conventions } : {}) });
}

export type { DecisionLink } from './domain/editing/properties/DecisionLinkReader.js';

export { ChangeSet, type Change } from './domain/document/ChangeSet.js';
export type { ValidateOptions, ValidationResult } from './domain/validation/StructuralValidator.js';
/** Structural validation and lint of a document, with the platform profile on request. */
export function validateDoc(doc: Doc, opts: ValidateOptions = {}): ValidationResult { return new ValidateDocumentService(NO_PROJECT, NO_FILES).validateStructure({ ...opts, doc }); }
/* the platform profile: Camunda 7 / 8 rules, loaded on demand */
export { PLATFORM_CHOICES, TARGETS, type Platform, type PlatformChoice, type PlatformInfo } from './domain/document/vendor/PlatformDetection.js';
export type { PlatformSummary, ProfileReport } from './domain/validation/profiles/PlatformProfiles.js';
export type { ProfileFinding, Severity } from './domain/document/Finding.js';
export type { ExtensionInfo } from './domain/document/ExtensionLister.js';
export { type ModelView, type ElementDetail, type DetailMessageFlow, type DetailData, type FindHit } from './domain/views/model-view.js';
export function buildView(doc: Doc): ModelView { return new ShowModelService().modelView({ doc }); }
export function elementDetail(doc: Doc, el: El): ElementDetail { return new ShowModelService().elementDetail({ doc, element: el }); }
export function findElements(doc: Doc, text: string, kind?: string): FindHit[] { return new FindElementsService().find({ doc, text, ...(kind !== undefined ? { kind } : {}) }); }
export { OPS_SCHEMA } from './adapters/in/report/OpsSchemaBuilder.js';
/* the diagram API: read-only views of a drawing and the format operations */
export { diffProblems, metricsDelta, KEYS as METRIC_KEYS, WEIGHTS as METRIC_WEIGHTS, type LayoutMetrics, type LayoutProblem, type ProblemLocation, type MetricKey, type MetricsDelta, type MetricsSummary } from './domain/diagram/utils/problems.js';
export { type LayoutView, type LayoutDiagram, type LayoutGroup, type LayoutColor, type LayoutLabel } from './domain/views/layout-view.js';
export function layoutView(defs: El): LayoutView { return new ShowModelService().layoutView({ definitions: defs }); }
export type { DiagramCommandResult as FormatResult, DiagramCommandEntry as FormatEntry } from './domain/diagram/commands/DiagramCommands.js';
export { SWATCHES, type SwatchName } from './domain/diagram/utils/colors.js';
/* the drawing as SVG; PNG: renderPng in @miragon/bpmn-cli/node */
export { RENDER_MAX_SIZE, MIN_LABEL_SCALE, HALO_COLORS, type RenderOptions, type RenderResult, type RenderHighlight, type RenderProblem, type RenderTile } from './domain/views/render/types.js';
export { changeHighlight } from './adapters/in/report/utils/highlight.js';
/** `bpmn render --format svg`: one plane of the document as SVG. */
export function renderSvg(xml: string, opts: RenderOptions = {}): Promise<RenderResult> { return new RenderSvgService().renderXml({ ...opts, xml }); }
/** One plane of a parsed document as SVG (no layout). */
export function renderDocSvg(doc: Doc, opts: RenderOptions = {}): RenderResult { return new RenderSvgService().renderDoc({ ...opts, doc }); }


/** The extension elements of an element, in order. */
export function listExtensions(el: El): ExtensionInfo[] {
  return new ShowModelService().extensions({ element: el });
}

/** `ext list`: the element's own extension elements, then those of its nested elements. */
export function listAllExtensions(el: El): ExtensionInfo[] {
  return new ShowModelService().allExtensions({ element: el });
}

/** Runs one op on its own. */
export function runOp(doc: Doc, op: EditCommand): ChangeSet {
  return new RunCommandsService().runModelCommand({ doc, command: op });
}

/** Runs a batch and returns what changed. */
export function runOps(doc: Doc, ops: EditCommand[]): ChangeSet {
  return new RunCommandsService().runModelCommands({ doc, commands: ops });
}

/** Validates the ops JSON (an array or `{ ops }`); a usage error names the op index. */
export function parseOps(input: unknown): EditCommand[] {
  return new RunCommandsService().parseCommands({ input });
}

/**
 * Loads the engine rules of `platform` (cached), needed before the synchronous runProfile and
 * validateDoc; the async API loads them itself. A failed load (E_PROFILE_LOAD) is retried later.
 */
export function loadProfile(platform: Platform): Promise<void> {
  return new ValidateDocumentService(NO_PROJECT, NO_FILES).loadProfile({ platform });
}

/** Loads the engine rules of several platforms (default: all). */
export function loadProfiles(platforms?: readonly Exclude<Platform, 'none'>[]): Promise<void> {
  return new ValidateDocumentService(NO_PROJECT, NO_FILES).loadProfiles(platforms !== undefined ? { platforms } : {});
}

/** Runs the profile of the document's platform (or `choice`); its rules must be loaded. */
export function runProfile(doc: Doc, choice?: PlatformChoice): ProfileReport {
  return new ValidateDocumentService(NO_PROJECT, NO_FILES).runProfile({ doc, ...(choice !== undefined ? { choice } : {}) });
}

/**
 * Detects the target engine: modeler:executionPlatform, else the vendor namespace the content
 * uses, else a declared one.
 */
export function detectPlatform(doc: Doc): PlatformInfo {
  return new ValidateDocumentService(NO_PROJECT, NO_FILES).detectPlatform({ doc });
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

/** The layout problems of every diagram; `importWarnings` count as one `failed` problem. */
export function layoutProblems(defs: El, opts: { importWarnings?: number } = {}): LayoutMetrics {
  return new AnalyzeLayoutService().measure({ ...opts, definitions: defs });
}

/** Parses `xml` and measures it (import warnings count as `failed`). */
export function layoutProblemsOfXml(xml: string): Promise<LayoutMetrics> {
  return new AnalyzeLayoutService().measureXml({ xml });
}

/** The problems with where each shows on its plane. */
export function locateProblems(defs: El, problems: readonly LayoutProblem[]): LayoutProblem[] {
  return new AnalyzeLayoutService().locateProblems({ definitions: defs, problems });
}

/**
 * Lays out the model. Its in-memory DI is replaced by the hint diagram as a side effect:
 * treat the returned XML as the truth and re-parse it if you need DI.
 */
export function layoutModel(model: Model, opts: LayoutOptions = {}): Promise<LayoutResult> {
  return new RelayoutDiagramService(NO_PROJECT, NO_FILES).layoutModel({ ...opts, model });
}
