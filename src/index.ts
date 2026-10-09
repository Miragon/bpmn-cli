export { Doc, TARGETS, type NewDocOptions } from './document.js';
export { CliError, type Warning } from './errors.js';
export { KINDS, parseKind, kindOf, kindLabel } from './kinds.js';
export { layoutModel, layoutXml } from './layout.js';
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
export { mutateFile, mutateDoc, checkFile, loadDoc, LAYOUT_MODES, type CheckOptions, type CheckResult, type LayoutMode, type LayoutStatus, type MutationOptions, type MutationResult } from './pipeline.js';
/* validators run inside the write transaction (MutationOptions.validators) and the design profile (design-iq's save gate) */
export type { NamedValidator, Validator, ValidatorContext, ValidatorFinding, ValidatorFn, ValidatorIssue, ValidatorReport, ValidatorSeverity } from './validators.js';
export { designFindings, designValidator, DESIGN_VALIDATOR, type DesignOptions } from './platform/design.js';
export { findContentRepo, resolveProfile, PROFILE_CHOICES, type ContentRepo, type ProfileChoice, type ProfileInfo } from './platform/repo.js';
export { decisionLinkOf, type DecisionLink } from './ops/decision.js';
export { ChangeSet } from './result.js';
export { validateDoc, type ValidateOptions, type ValidationResult } from './validate.js';
/* the platform profile (Camunda 7 rules; validate --platform) */
export { runProfile, PLATFORM_CHOICES, type Platform, type PlatformChoice, type PlatformInfo, type PlatformSummary, type ProfileFinding, type ProfileReport, type Severity } from './platform/profile.js';
export { detectPlatform } from './platform/detect.js';
export { listExtensions, listAllExtensions, type ExtensionInfo } from './ops/ext.js';
export { buildView, elementDetail, findElements } from './view.js';
export { parseOps, OPS_SCHEMA } from './batch.js';
/* the diagram API: read-only views of a drawing and the format operations */
export { layoutProblems, layoutProblemsOfXml, diffProblems, metricsDelta, KEYS as METRIC_KEYS, WEIGHTS as METRIC_WEIGHTS, type LayoutMetrics, type LayoutProblem, type MetricKey, type MetricsDelta, type MetricsSummary } from './diagram/metrics.js';
export { layoutView, type LayoutView, type LayoutDiagram, type LayoutGroup, type LayoutColor, type LayoutLabel } from './diagram/view.js';
export { runFormatOps, type FormatResult, type FormatEntry } from './diagram/ops.js';
export { SWATCHES, type SwatchName } from './diagram/write.js';
