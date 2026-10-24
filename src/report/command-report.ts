/**
 * What a command reports, as data and as text: the same for the CLI (its
 * `--json` output and its text output) and for the in-memory API
 * (src/api.ts), so a host that embeds the library hands its agent exactly
 * what the CLI would print.
 *
 *   MutationReportBuilder(result)  opWarnings(): the op warnings without the ones the validator repeats;
 *                                  warnings(): every warning of a mutation (what --strict counts);
 *                                  report(): the JSON of a mutation (no XML): warnings as a delta
 *                                  (added / resolved / preexistingCount), not every warning of the file
 *   MutationText(report, { dryRun })  its text (also of applyToXml's `result`)
 *   MutationSummaryBuilder(report) `--summary`: created ids by kind, batch aliases, changed / renamed / removed ids, the format ops,
 *                                  the added warnings, what validators left out, the layout score and added problems, the ids that
 *                                  follow declared conventions
 *   SummaryText(summary, { dryRun, advisory })  its text
 *   ValidationReportBuilder(check) the JSON of `bpmn validate` (layout failures and warnings folded in)
 *   ValidationText(report)         its text
 *
 * An advisory validator's findings (`blocks: false`: the project's bpmnlint)
 * group by code and message in the text of a result (one convention per
 * line); an error among them reads `[bpmnlint error]` (in validate too), and
 * its validator line says how many it added, resolved and found already in
 * the file (`--summary` counts those among the warnings already in the
 * file) and, in a write, how many it left out of the comparison (`--summary`
 * too). validate's text folds one of its rules with FLOOD_MIN findings or
 * more of one hint into one line (`--json` lists every finding).
 */
import type { LayoutProblem } from '../diagram/metrics.js';
import type { FormatResult } from '../format/index.js';
import type { Warning } from '../shared/CliError.js';
import type { CheckResult, ConventionsReport, LayoutStatus } from '../pipeline/index.js';
import type { PlatformSummary } from '../platform/profiles/PlatformProfiles.js';
import type { Change } from '../model/ChangeSet.js';
import type { ValidationResult } from '../validate/structural.js';
import type { ValidatorReport } from '../validate/validators.js';
import type { ModelView } from '../query/model-view.js';

/**
 * The warnings of a mutation as a delta against the file before it: what the
 * change added is listed, what it resolved too, what the file already had is
 * only counted (`bpmn validate` lists it).
 */
export interface WarningReport {
  /** warnings the change introduced: op warnings, validation findings (lint, platform profile, validators) and layout warnings (W_LAYOUT_<code>) */
  added: Warning[];
  /** findings the change resolved (warnings and errors the file had before) */
  resolved: Warning[];
  /** warnings the file already had and still has, W_PREEXISTING_ERROR and the platform profile's findings included: counted, not repeated */
  preexistingCount: number;
}

/** The JSON of a mutation (`--json`; `result` of applyToXml without file and written). */
export interface MutationReport {
  ok: true;
  file?: string;
  /** false with dryRun, and when the result equals the file it would overwrite (`unchanged`) */
  written: boolean;
  /** the result is the input text byte for byte (the ops changed nothing that is written) */
  unchanged: boolean;
  created: Change[];
  changed: Change[];
  removed: Change[];
  /** the warnings the change added and resolved, and the number of the file's own (see WarningReport) */
  warnings: WarningReport;
  notes: string[];
  /** batch aliases -> the final id of their element (`bpmn apply` with `"as": "$name"`) */
  aliases?: Record<string, string>;
  /** ids the change renamed (a flow whose id named its old ends, renamed after its new ones; none with keepFlowIds: W_FLOW_ID_STALE instead): old id -> new id */
  renamed?: Record<string, string>;
  layout: LayoutStatus;
  /** errors a forced write let through, the platform summary and the validators that ran; the warnings are in `warnings` */
  validation: Omit<ValidationResult, 'warnings'>;
  importWarnings: string[];
  view?: ModelView;
  /** the new ids under a prefix the project's declared id conventions name (element-id-naming of the .bpmnlintrc) that the file's own style would give otherwise, and where those come from */
  conventions?: ConventionsReport;
}

/** The JSON of `bpmn validate` (`file` aside). */
export interface ValidationReport {
  ok: boolean;
  /** structural errors and a failed layout dry run */
  errors: Warning[];
  /** lint, platform findings and the layout dry run's warnings (W_LAYOUT_<code>) */
  warnings: Warning[];
  platform?: PlatformSummary;
  /** the validators that ran (the project's bpmnlint; a host's `validators` in library use): every finding of each; they are among errors / warnings too */
  validators?: ValidatorReport[];
  layout: CheckResult['layout'];
  /** content the reader could not keep or understand */
  importWarnings: string[];
}

/** A mutation report with or without the file it was written to (applyToXml's `result` has none). */
export type MutationReportLike = Omit<MutationReport, 'file' | 'written'> & { file?: string; written?: boolean };

/** `--summary`: what a mutation did in a few lines (JSON: mutationSummary, text: renderSummary). */
export interface MutationSummary {
  ok: true;
  file?: string;
  written?: boolean;
  unchanged: boolean;
  /** created ids by kind, in the order they were created */
  created: Record<string, string[]>;
  /** batch aliases -> the final id of their element (`bpmn apply` with `"as": "$name"`) */
  aliases?: Record<string, string>;
  changed: string[];
  /** ids the change renamed: old id -> new id (a flow whose id named its old ends) */
  renamed?: Record<string, string>;
  removed: string[];
  /** errors a forced write (--force) let through */
  forced?: Warning[];
  /** preexistingCount: the warnings the file already had, and the findings of an advisory validator (bpmnlint) the file already had (the full result counts those in its validator line) */
  warnings: { added: Warning[]; resolvedCount: number; preexistingCount: number };
  /** the findings validators left out of the comparison (ValidatorReport.leftOut), per validator and reason; absent when there are none */
  leftOut?: Array<{ validator: string; reason: string; count: number }>;
  /**
   * the layout that ran, the score before -> after, the layout problems the
   * change added; without a drawing before, only how many problems the
   * result has (`bpmn metrics` lists them)
   */
  layout: { status: 'ok' | 'skipped'; mode?: 'full' | 'incremental'; score?: { before?: number; after: number }; added?: LayoutProblem[]; problems?: number };
  /** what each format op (place, align, color, compact, lane / pool order, ...) did to the drawing, in batch order */
  format?: FormatResult[];
  /** the new ids that follow the declared id conventions rather than the file's own style (MutationReport.conventions) */
  conventions?: ConventionsReport;
}
