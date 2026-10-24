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
import { TextPreservation, type PreservedText } from './xml/TextPreservation.js';
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
export { Doc, TARGETS, type DocSource, type NewDocOptions } from './model/document.js';
export { CliError, EXIT_CODES, type ErrorCategory, type Warning } from './shared/CliError.js';
export { KINDS, parseKind, kindOf, kindLabel } from './model/kinds.js';
export { layoutModel } from './layout/index.js';
export { runOp, runOps } from './ops/index.js';
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
export { mutateDoc, layoutDoc, checkDoc, assertLossless, LAYOUT_MODES, type CheckOptions, type CheckResult, type ConventionsReport, type LayoutDocOptions, type LayoutMode, type LayoutStatus, type MutationOptions, type MutationResult, type ValidationDelta } from './pipeline/index.js';
/* text-preserving output: what mutateDoc uses to keep a file's formatting (for hosts that serialise models themselves) */
export { type PreservedText } from './xml/TextPreservation.js';
export function preserveText(original: string, baseline: string, next: string): Promise<PreservedText> { return new TextPreservation(original, baseline, next).result(); }
/* a host's validators, run inside the write transaction (MutationOptions.validators) and by validate (CheckOptions.validators) */
export type { NamedValidator, Validator, ValidatorContext, ValidatorFinding, ValidatorFn, ValidatorIssue, ValidatorReport, ValidatorSeverity } from './validate/validators.js';
/* the project's bpmnlint configuration as an advisory validator; bpmnlint itself is injected (@miragon/bpmn-cli/node loads it) */
export { bpmnlintValidator, resolveBpmnlintConfig, BPMNLINT_COVERS, BPMNLINT_VALIDATOR, type BpmnlintConfig, type BpmnlintEngine, type BpmnlintLinter, type BpmnlintLinterClass, type BpmnlintReport, type BpmnlintResolver, type BpmnlintRule, type BpmnlintRuleSetting, type BpmnlintSeverity, type BpmnlintUnavailable, type BpmnlintValidatorOptions, type ResolvedBpmnlintConfig } from './validate/bpmnlint-validator.js';
/* declared id conventions: what element-id-naming of the project's .bpmnlintrc says about new ids (its naming helpers injected; @miragon/bpmn-cli/node reads the .bpmnlintrc) */
export { idConventionsFromLint, conventionsView, renderConventions, ID_NAMING_RULE, type IdConventions, type IdNamingHelpers, type QualifierMode, type ConventionsView, type ConventionsRow, type Undeclared } from './ids/conventions.js';
export { decisionLinkOf, type DecisionLink } from './ops/decision.js';
export { ChangeSet, type Change } from './model/change-set.js';
export { validateDoc, type ValidateOptions, type ValidationResult } from './validate/structural.js';
/* the platform profile (Camunda 7 / 8 rules, loaded on demand; validate --platform) */
export { runProfile, loadProfile, loadProfiles, PLATFORM_CHOICES, type Platform, type PlatformChoice, type PlatformInfo, type PlatformSummary, type ProfileFinding, type ProfileReport, type Severity } from './platform/profiles/profile.js';
export { detectPlatform } from './platform/detect.js';
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
