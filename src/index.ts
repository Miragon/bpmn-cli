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
/* the in-memory API: strings in, strings / data out (README "Library use") */
export { applyToXml, newXml, layoutXml, validateXml, viewXml, showXml, metricsXml, findXml, extensionsXml, type EditOptions, type EditResult, type EditReport, type LayoutXmlOptions, type ValidateXmlOptions, type ViewOptions } from './api.js';
export { mutationReport, mutationWarnings, opWarnings, renderMutation, validationReport, renderValidation, type MutationReport, type MutationReportLike, type ValidationReport } from './report.js';
export { renderView, renderDetail, renderLayoutView, renderFind, renderMetrics, renderExtensionList, renderProblems } from './format.js';
export { setLayoutDebug, type DebugSink } from './debug.js';
export { guideText, kindsJson, kindsText, ERROR_CATALOGUE } from './guide.js';
/* the building blocks */
export { Doc, TARGETS, type DocSource, type NewDocOptions } from './document.js';
export { CliError, EXIT_CODES, type ErrorCategory, type Warning } from './errors.js';
export { KINDS, parseKind, kindOf, kindLabel } from './kinds.js';
export { layoutModel } from './layout.js';
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
export { mutateDoc, layoutDoc, checkDoc, assertLossless, LAYOUT_MODES, type CheckOptions, type CheckResult, type LayoutDocOptions, type LayoutMode, type LayoutStatus, type MutationOptions, type MutationResult } from './pipeline.js';
/* text-preserving output: what mutateDoc uses to keep a file's formatting (for hosts that serialise models themselves) */
export { preserveText, type PreservedText } from './preserve.js';
/* validators run inside the write transaction (MutationOptions.validators) and the design profile (design-iq's save gate) */
export type { NamedValidator, Validator, ValidatorContext, ValidatorFinding, ValidatorFn, ValidatorIssue, ValidatorReport, ValidatorSeverity } from './validators.js';
export { designFindings, designValidator, DESIGN_VALIDATOR, type DesignOptions } from './platform/design.js';
export { resolveProfile, profileValidators, modelsFolderOf, PROFILE_CHOICES, CONTENT_CONFIG_FILE, type ContentRepo, type ProfileChoice, type ProfileInfo } from './platform/repo.js';
export { decisionLinkOf, type DecisionLink } from './ops/decision.js';
export { ChangeSet, type Change } from './result.js';
export { validateDoc, type ValidateOptions, type ValidationResult } from './validate.js';
/* the platform profile (Camunda 7 rules; validate --platform) */
export { runProfile, PLATFORM_CHOICES, type Platform, type PlatformChoice, type PlatformInfo, type PlatformSummary, type ProfileFinding, type ProfileReport, type Severity } from './platform/profile.js';
export { detectPlatform } from './platform/detect.js';
export { listExtensions, listAllExtensions, type ExtensionInfo } from './ops/ext.js';
export { buildView, elementDetail, findElements, scopeView, type ModelView, type ElementDetail, type FindHit } from './view.js';
export { parseOps, OPS_SCHEMA } from './batch.js';
/* the diagram API: read-only views of a drawing and the format operations */
export { layoutProblems, layoutProblemsOfXml, diffProblems, metricsDelta, KEYS as METRIC_KEYS, WEIGHTS as METRIC_WEIGHTS, type LayoutMetrics, type LayoutProblem, type MetricKey, type MetricsDelta, type MetricsSummary } from './diagram/metrics.js';
export { layoutView, type LayoutView, type LayoutDiagram, type LayoutGroup, type LayoutColor, type LayoutLabel } from './diagram/view.js';
export { runFormatOps, type FormatResult, type FormatEntry } from './diagram/ops.js';
export { SWATCHES, type SwatchName } from './diagram/write.js';
