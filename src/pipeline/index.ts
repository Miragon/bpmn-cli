import type { IdConventions } from '../ids/IdConventionsReader.js';
import type { DebugSink } from '../shared/LayoutDebug.js';
import type { Warning } from '../shared/CliError.js';
import type { LayoutWarningInfo, LayoutEngine } from '../layout/FullLayout.js';
import type { MetricsDelta } from '../diagram/utils/problems.js';
import type { FormatResult } from '../format/FormatOps.js';
import type { ChangeSet } from '../model/ChangeSet.js';
import type { PlatformChoice } from '../platform/PlatformDetection.js';
import type { ValidationResult } from '../validate/StructuralValidator.js';
import type { ValidationDelta } from '../validate/FindingBaseline.js';
import type { Validator } from '../validate/validators.js';
import type { ModelView } from '../query/model-view.js';

/** Options of the in-memory write pipeline (mutateDoc). */
export interface MutationOptions {
  /**
   * false skips the layout; true / 'auto' (default) keeps a hand-made drawing and redraws
   * an engine-owned one
   */
  layout?: boolean | LayoutMode;
  /** write despite lossy import / validation errors */
  force?: boolean;
  show?: boolean;
  /** additional sub-process ids to expand / collapse */
  expand?: string[];
  collapse?: string[];
  /** 'clean' (default) or 'auto' (bpmn-auto-layout) */
  engine?: LayoutEngine;
  /** platform profile whose new findings are reported: 'auto' (default), 'none' switches it off */
  platform?: PlatformChoice;
  /** receives the layout engines' diagnostic lines during this call */
  debug?: DebugSink;
  /** run on the candidate XML; errors the change introduces block the write */
  validators?: Validator[];
  /** the file being written, for the validators; default doc.file */
  file?: string;
  /**
   * true keeps a flow's id when an op gives it other ends (where flow ids are API, e.g.
   * generated code); false renames a flow whose id names its old ends
   */
  keepFlowIds?: boolean;
  /** declared id conventions, followed by generated ids where they declare a prefix */
  conventions?: IdConventions;
}

export type LayoutMode = 'auto' | 'incremental' | 'full';

export const LAYOUT_MODES: readonly LayoutMode[] = ['auto', 'incremental', 'full'];

export interface LayoutStatus {
  status: 'ok' | 'skipped';
  mode?: 'full' | 'incremental';
  reason?: string;
  warnings: LayoutWarningInfo[];
  expanded: string[];
  /** incremental: elements that got new DI */
  placed?: string[];
  /** incremental: pre-existing shapes whose bounds changed */
  moved?: string[];
  /** incremental: pre-existing connections that were routed again */
  rerouted?: string[];
  /** incremental: pre-existing connections stretched or shortened without being routed again */
  reshaped?: string[];
  pruned?: string[];
  notes?: string[];
  /** layout problems before / after, and the difference */
  metrics?: MetricsDelta;
  /** in batch order */
  format?: FormatResult[];
  /** design-iq stickies moved along with their flow node (`<processId>#<n>` without id) */
  stickies?: Array<{ sticky: string; node: string }>;
}

export interface MutationResult {
  ok: true;
  file?: string;
  /** always false from the in-memory pipeline; an `unchanged` result is not written back */
  written: boolean;
  /** the result is the input text byte for byte */
  unchanged: boolean;
  changes: ChangeSet;
  /** batch aliases (`"as": "$name"`) -> the final id of their element */
  aliases?: Record<string, string>;
  layout: LayoutStatus;
  validation: ValidationResult;
  importWarnings: string[];
  /**
   * the findings the change added and resolved against the document before the ops;
   * absent for a document created in memory
   */
  delta?: ValidationDelta;
  view?: ModelView;
  xml: string;
  /** generated ids that follow the declared conventions rather than the file's own style */
  conventions?: ConventionsReport;
}

export interface ConventionsReport {
  ids: string[];
  /** e.g. `.bpmnlintrc in models` */
  source?: string;
}


/** Options of `bpmn layout` (layoutDoc): a full redraw, or with `tidy` only overlaps removed. */
export interface LayoutDocOptions extends Omit<MutationOptions, 'layout'> {
  /** keep the drawing, only remove overlaps and gaps < 20 px; no expand / collapse */
  tidy?: boolean;
}

/** Options of `bpmn validate` (checkDoc, checkFile, validateXml). */
export interface CheckOptions {
  platform?: PlatformChoice;
  /** their errors fail the check, an advisory one's too */
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
