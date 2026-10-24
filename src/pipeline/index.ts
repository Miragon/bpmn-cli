/**
 * The options and results of the write pipeline (pipeline/EditTransaction.ts:
 * mutateDoc), of `bpmn layout` (pipeline/Relayout.ts: layoutDoc) and of
 * `bpmn validate` (pipeline/DocCheck.ts: checkDoc).
 */
import type { IdConventions } from '../ids/conventions.js';
import type { DebugSink } from '../shared/LayoutDebug.js';
import type { Warning } from '../shared/CliError.js';
import type { LayoutWarningInfo, LayoutEngine } from '../layout/index.js';
import type { MetricsDelta } from '../diagram/metrics.js';
import type { FormatResult } from '../format/index.js';
import type { ChangeSet } from '../model/ChangeSet.js';
import type { PlatformChoice } from '../platform/profiles/profile.js';
import type { ValidationResult } from '../validate/structural.js';
import type { ValidationDelta } from '../validate/FindingBaseline.js';
import type { Validator } from '../validate/validators.js';
import type { ModelView } from '../query/model-view.js';

/**
 * Options of the in-memory pipeline. Writing (out, dryRun, backup,
 * mustNotExist) is the node layer's: FileMutationOptions in src/node/files.ts.
 */
export interface MutationOptions {
  /**
   * diagram handling: false = skip (stale DI), true / 'auto' (default) = keep a
   * hand-made drawing and redraw an engine-owned one, 'incremental', 'full'
   */
  layout?: boolean | LayoutMode;
  /** write despite lossy import / validation errors */
  force?: boolean;
  /** include the model view in the result */
  show?: boolean;
  /** additional sub-process ids to expand / collapse (layout command) */
  expand?: string[];
  collapse?: string[];
  /** layout engine: 'clean' (default) or 'auto' (bpmn-auto-layout) */
  engine?: LayoutEngine;
  /** platform profile whose new findings are reported: 'auto' (default) detects it, 'none' switches it off */
  platform?: PlatformChoice;
  /** receives the layout engines' diagnostic lines during this call (src/shared/LayoutDebug.ts; the CLI: BPMN_LAYOUT_DEBUG) */
  debug?: DebugSink;
  /** validators run on the candidate XML inside the transaction (src/validate/validators.ts); errors they find in the change block the write */
  validators?: Validator[];
  /** the file being written, for the validators (`ctx.file`); default doc.file (the node layer passes its target) */
  file?: string;
  /**
   * true keeps the id of every sequence flow the document had when an op
   * gives it other ends (where flow ids are API: generated code, process
   * tests); W_FLOW_ID_STALE names each one whose id no longer names its
   * ends. false renames a flow whose id names its old ends after its new
   * ones (the CLI's default). Undefined: Doc.followFlowEnds decides.
   */
  keepFlowIds?: boolean;
  /**
   * the project's declared id conventions (src/ids/conventions.ts: the
   * prefixes, case and qualifier of element-id-naming; the node layer reads
   * them from the .bpmnlintrc it runs): ids the change generates follow
   * them where they declare a prefix, the file's own style elsewhere;
   * existing ids stay. Undefined: Doc.conventions
   */
  conventions?: IdConventions;
}

export type LayoutMode = 'auto' | 'incremental' | 'full';

export const LAYOUT_MODES: readonly LayoutMode[] = ['auto', 'incremental', 'full'];

export interface LayoutStatus {
  status: 'ok' | 'skipped';
  /** the layout that ran (status ok) */
  mode?: 'full' | 'incremental';
  /** why that mode ran */
  reason?: string;
  warnings: LayoutWarningInfo[];
  expanded: string[];
  /** incremental: elements that got new DI */
  placed?: string[];
  /** incremental: pre-existing shapes whose bounds changed */
  moved?: string[];
  /** incremental: pre-existing connections that were routed again */
  rerouted?: string[];
  /** incremental: pre-existing connections stretched or shortened (their ends or bends moved) without being routed again */
  reshaped?: string[];
  /** DI of removed elements that was deleted */
  pruned?: string[];
  /** incremental: what else the placement did or could not do; full: a group around nothing kept or moved below the drawing */
  notes?: string[];
  /** layout problems before (when a diagram existed) / after, and the difference */
  metrics?: MetricsDelta;
  /** what each format op (and lane order) of the batch did to the drawing, in batch order */
  format?: FormatResult[];
  /** design-iq stickies moved along with their flow node (sticky id, or `<processId>#<n>` without id) */
  stickies?: Array<{ sticky: string; node: string }>;
}

export interface MutationResult {
  ok: true;
  /** the document's file name (Doc.file), or the file written to (node layer) */
  file?: string;
  /** whether the node layer wrote the file; always false from the in-memory pipeline (mutateDoc). The node layer does not write a result that is `unchanged` over its own file */
  written: boolean;
  /** the result is the input text byte for byte (the ops changed nothing that is written) */
  unchanged: boolean;
  changes: ChangeSet;
  /** batch aliases (`"as": "$name"`, ops/aliases.ts) -> the final id of their element; absent without aliases */
  aliases?: Record<string, string>;
  layout: LayoutStatus;
  validation: ValidationResult;
  /** import warnings of the loaded file (informational) */
  importWarnings: string[];
  /**
   * the validation findings against the document before the ops: the
   * warnings the change added, the findings it resolved, and how many it
   * left as they were (lint warnings the document had, W_PREEXISTING_ERROR);
   * what a result reports instead of every warning of the document. Absent
   * for a document created in memory (`new`): every warning is reported
   */
  delta?: ValidationDelta;
  view?: ModelView;
  xml: string;
  /** the ids the change generated under a prefix the declared conventions name that the file's own style would give otherwise, and where the conventions come from; absent when there are none */
  conventions?: ConventionsReport;
}

/** MutationResult.conventions: the new ids that follow the declared conventions rather than the file's own style. */
export interface ConventionsReport {
  ids: string[];
  /** IdConventions.source (`.bpmnlintrc in models`) */
  source?: string;
}


/** Options of `bpmn layout` (layoutDoc): a full redraw, or with `tidy` only overlaps removed. */
export interface LayoutDocOptions extends Omit<MutationOptions, 'layout'> {
  /** keep the drawing and only remove overlaps and gaps < 20 px (= `bpmn layout --tidy`); expand / collapse must be absent */
  tidy?: boolean;
}

/** Options of `bpmn validate` (checkDoc, checkFile, validateXml). */
export interface CheckOptions {
  /** platform profile: 'auto' (default) detects it */
  platform?: PlatformChoice;
  /** validators (src/validate/validators.ts), run on the document's XML; their errors fail the check (an advisory one's too) */
  validators?: Validator[];
  /** the file being checked, for the validators (default doc.file) */
  file?: string;
  /** receives the layout engines' diagnostic lines during this call */
  debug?: DebugSink;
}

/** What `bpmn validate` finds in a document (checkDoc). */
export interface CheckResult {
  validation: ValidationResult;
  layout: LayoutStatus | { status: 'failed'; error: Warning };
  importWarnings: string[];
}
