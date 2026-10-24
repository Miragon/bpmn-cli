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
import type { BpmnlintRuleSetting, BpmnlintSeverity } from './validate/bpmnlint-validator.js';
import type { ValidatorFinding } from './validate/validators.js';
import { PlatformDetection, type Platform, type PlatformChoice, type PlatformInfo } from './platform/PlatformDetection.js';
import { PLATFORM_PROFILES, type ProfileReport } from './platform/profiles/PlatformProfiles.js';

/* the in-memory API: strings in, strings / data out (docs/library.md) */
export { applyToXml, newXml, layoutXml, validateXml, viewXml, showXml, conventionsXml, metricsXml, findXml, extensionsXml, viewDoc, renderShown, type EditOptions, type EditResult, type EditReport, type LayoutXmlOptions, type ShownView, type ValidateXmlOptions, type ViewOptions } from './api.js';
export { mutationReport, mutationWarnings, opWarnings, renderMutation, mutationSummary, renderSummary, advisoryValidators, warningLines, conventionsLines, validationReport, renderValidation, type MutationReport, type MutationReportLike, type MutationSummary, type ValidationReport, type WarningReport } from './report/command-report.js';
export { renderView, renderDetail, renderAround, renderContext, renderLayoutView, renderFind, renderMetrics, renderExtensionList, renderProblems } from './report/view-text.js';
export { setLayoutDebug } from './api.js';
export { type DebugSink } from './shared/LayoutDebug.js';
export { guideText, guideShort, guideTopic, GUIDE_TOPICS, kindsJson, kindsText, kindsSections, kindsSectionJson, kindsSectionText, ERROR_CATALOGUE } from './report/guide.js';
/* the reading views of large models: the neighbourhood of an element (show --around) and an element in its context (show <id> --context) */
export { aroundView, elementContext, implementationOf, AROUND_DEFAULT_DEPTH, type AroundOptions, type AroundView, type AroundNode, type AroundScope, type ElementContext, type ContextRef, type ContextLink, type ContextCatch, type ContextEventSubProcess, type Implementation } from './query/context.js';
/* the building blocks */
export { Doc, TARGETS, type DocSource, type NewDocOptions } from './model/Doc.js';
export { CliError, EXIT_CODES, type ErrorCategory, type Warning } from './shared/CliError.js';
export { KINDS, parseKind, kindOf, kindLabel } from './model/kinds.js';
export { layoutModel } from './layout/index.js';
export { FORMAT_OP_NAMES, isFormatOp } from './ops/types.js';
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
export { preserveText, type PreservedText } from './xml/preserve.js';
/* a host's validators, run inside the write transaction (MutationOptions.validators) and by validate (CheckOptions.validators) */
export type { NamedValidator, Validator, ValidatorContext, ValidatorFinding, ValidatorFn, ValidatorIssue, ValidatorReport, ValidatorSeverity } from './validate/validators.js';
/* the project's bpmnlint configuration as an advisory validator; bpmnlint itself is injected (@miragon/bpmn-cli/node loads it) */
export { bpmnlintValidator, resolveBpmnlintConfig, BPMNLINT_COVERS, BPMNLINT_VALIDATOR, type BpmnlintConfig, type BpmnlintEngine, type BpmnlintLinter, type BpmnlintLinterClass, type BpmnlintReport, type BpmnlintResolver, type BpmnlintRule, type BpmnlintRuleSetting, type BpmnlintSeverity, type BpmnlintUnavailable, type BpmnlintValidatorOptions, type ResolvedBpmnlintConfig } from './validate/bpmnlint-validator.js';
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

export { decisionLinkOf, type DecisionLink } from './ops/decision.js';
export { ChangeSet, type Change } from './model/ChangeSet.js';
export { validateDoc, type ValidateOptions, type ValidationResult } from './validate/structural.js';
/* the platform profile (Camunda 7 / 8 rules, loaded on demand; validate --platform) */
export { PLATFORM_CHOICES, type Platform, type PlatformChoice, type PlatformInfo } from './platform/PlatformDetection.js';
export type { PlatformSummary, ProfileReport } from './platform/profiles/PlatformProfiles.js';
export type { ProfileFinding, Severity } from './platform/utils/finding.js';
export { listExtensions, listAllExtensions, type ExtensionInfo } from './ops/ext.js';
export { buildView, elementDetail, findElements, scopeView, type ModelView, type ElementDetail, type DetailMessageFlow, type DetailData, type FindHit } from './query/model-view.js';
export { parseOps, OPS_SCHEMA } from './ops/batch.js';
/* the diagram API: read-only views of a drawing and the format operations */
export { layoutProblems, layoutProblemsOfXml, locateProblems, diffProblems, metricsDelta, KEYS as METRIC_KEYS, WEIGHTS as METRIC_WEIGHTS, type LayoutMetrics, type LayoutProblem, type ProblemLocation, type MetricKey, type MetricsDelta, type MetricsSummary } from './diagram/metrics.js';
export { layoutView, type LayoutView, type LayoutDiagram, type LayoutGroup, type LayoutColor, type LayoutLabel } from './query/layout-view.js';
export { runFormatOps, type FormatResult, type FormatEntry } from './format/index.js';
export { SWATCHES, type SwatchName } from './diagram/write.js';
/* the drawing as an image: one diagram plane as SVG (`bpmn render --format svg`; PNG: renderPng in @miragon/bpmn-cli/node) */
export { renderSvg, renderDocSvg, changeHighlight, RENDER_MAX_SIZE, MIN_LABEL_SCALE, HALO_COLORS, type RenderOptions, type RenderResult, type RenderHighlight, type RenderProblem, type RenderTile } from './render/index.js';

/** Runs one op on its own (src/ops/OpRunner.ts). */
export function runOp(doc: Doc, op: Op): ChangeSet {
  return new OpRunner(doc).runOp(op);
}

/** Runs a batch (OpRunner.runBatch) and returns what changed. */
export function runOps(doc: Doc, ops: Op[]): ChangeSet {
  return new OpRunner(doc).runBatch(ops).changes;
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
