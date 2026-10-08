export { Doc } from './document.js';
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
export { mutateFile, mutateDoc, checkFile, loadDoc, LAYOUT_MODES, type LayoutMode, type LayoutStatus, type MutationOptions, type MutationResult } from './pipeline.js';
export { ChangeSet } from './result.js';
export { validateDoc } from './validate.js';
export { buildView, elementDetail, findElements } from './view.js';
export { parseOps, OPS_SCHEMA } from './batch.js';
/* the diagram API: read-only views of a drawing and the format operations */
export { layoutProblems, layoutProblemsOfXml, diffProblems, metricsDelta, KEYS as METRIC_KEYS, WEIGHTS as METRIC_WEIGHTS, type LayoutMetrics, type LayoutProblem, type MetricKey, type MetricsDelta, type MetricsSummary } from './diagram/metrics.js';
export { layoutView, type LayoutView, type LayoutDiagram, type LayoutGroup, type LayoutColor, type LayoutLabel } from './diagram/view.js';
export { runFormatOps, type FormatResult, type FormatEntry } from './diagram/ops.js';
export { SWATCHES, type SwatchName } from './diagram/write.js';
