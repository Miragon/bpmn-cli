/**
 * What a command reports, as data and as text: the same for the CLI and the in-memory API, so
 * a host that embeds the library hands its agent exactly what the CLI would print.
 */
import type { LayoutProblem } from '../../../domain/diagram/utils/problems.js';
import type { FormatResult } from '../../../domain/diagram/DiagramCommandService.js';
import type { Warning } from '../../../domain/document/CliError.js';
import type { CheckResult } from '../../../application/port/in/ValidateDocumentUseCase.js';
import type { ConventionsReport } from '../../../domain/batch/types.js';
import type { LayoutStatus } from '../../../domain/diagram/types.js';
import type { PlatformSummary } from '../../../domain/validation/profiles/PlatformProfiles.js';
import type { Change } from '../../../domain/document/ChangeSet.js';
import type { ValidationResult } from '../../../domain/validation/StructuralValidator.js';
import type { ValidatorReport } from '../../../domain/validation/validators.js';
import type { ModelView } from '../../../domain/views/model-view.js';

/**
 * The warnings of a mutation as a delta against the file before it; what the file already had
 * is only counted (`bpmn validate` lists it).
 */
export interface WarningReport {
  added: Warning[];
  resolved: Warning[];
  preexistingCount: number;
}

/** The JSON of a mutation (`--json`). */
export interface MutationReport {
  ok: true;
  file?: string;
  /** false with dryRun and when `unchanged` */
  written: boolean;
  /** the result is the input text byte for byte */
  unchanged: boolean;
  created: Change[];
  changed: Change[];
  removed: Change[];
  warnings: WarningReport;
  notes: string[];
  /** batch alias -> the final id of its element */
  aliases?: Record<string, string>;
  /** old id -> new id, e.g. a flow whose id named its old ends */
  renamed?: Record<string, string>;
  layout: LayoutStatus;
  validation: Omit<ValidationResult, 'warnings'>;
  importWarnings: string[];
  view?: ModelView;
  /** new ids that follow the declared id conventions rather than the file's own style */
  conventions?: ConventionsReport;
}

/** The JSON of `bpmn validate`. */
export interface ValidationReport {
  ok: boolean;
  errors: Warning[];
  warnings: Warning[];
  platform?: PlatformSummary;
  /** every finding of each validator that ran; they are among errors / warnings too */
  validators?: ValidatorReport[];
  layout: CheckResult['layout'];
  importWarnings: string[];
}

export type MutationReportLike = Omit<MutationReport, 'file' | 'written'> & { file?: string; written?: boolean };

/** `--summary`: what a mutation did in a few lines. */
export interface MutationSummary {
  ok: true;
  file?: string;
  written?: boolean;
  unchanged: boolean;
  created: Record<string, string[]>;
  aliases?: Record<string, string>;
  changed: string[];
  renamed?: Record<string, string>;
  removed: string[];
  forced?: Warning[];
  /** preexistingCount includes the advisory validators' findings the file already had */
  warnings: { added: Warning[]; resolvedCount: number; preexistingCount: number };
  /** the findings validators left out of the comparison, per validator and reason */
  leftOut?: Array<{ validator: string; reason: string; count: number }>;
  /** without a drawing before, only how many problems the result has */
  layout: { status: 'ok' | 'skipped'; mode?: 'full' | 'incremental'; score?: { before?: number; after: number }; added?: LayoutProblem[]; problems?: number };
  format?: FormatResult[];
  conventions?: ConventionsReport;
}
