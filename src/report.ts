/**
 * What a command reports, as data and as text: the same for the CLI (its
 * `--json` output and its text output) and for the in-memory API
 * (src/api.ts), so a host that embeds the library hands its agent exactly
 * what the CLI would print.
 *
 *   opWarnings(result)        the op warnings without the ones the validator repeats
 *   mutationWarnings(result)  every warning of a mutation (what --strict counts)
 *   mutationReport(result)    the JSON of a mutation (no XML)
 *   renderMutation(report, { dryRun })  its text (also of applyToXml's `result`)
 *   validationReport(check)   the JSON of `bpmn validate` (layout failures and warnings folded in)
 *   renderValidation(report)  its text
 */
import type { Warning } from './errors.js';
import { renderChanges, renderLayout, renderProblems, renderView } from './format.js';
import type { CheckResult, LayoutStatus, MutationResult } from './pipeline.js';
import type { PlatformSummary } from './platform/profile.js';
import { ChangeSet, type Change } from './result.js';
import type { ValidationResult } from './validate.js';
import type { ModelView } from './view.js';

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
  /** op warnings (the validator's own findings are in validation.warnings) */
  warnings: Warning[];
  notes: string[];
  layout: LayoutStatus;
  validation: ValidationResult;
  importWarnings: string[];
  view?: ModelView;
}

/** The JSON of `bpmn validate` (`file` aside). */
export interface ValidationReport {
  ok: boolean;
  /** structural errors and a failed layout dry run */
  errors: Warning[];
  /** lint, platform findings and the layout dry run's warnings (W_LAYOUT_<code>) */
  warnings: Warning[];
  platform?: PlatformSummary;
  layout: CheckResult['layout'];
  /** content the reader could not keep or understand */
  importWarnings: string[];
}

/** The key under which an op warning and a validation warning are the same finding. */
function findingKey(w: Warning): string {
  // an event-gateway finding is about one branch: the same code on another target of the gateway is another finding
  return `${w.code}|${w.element ?? ''}${w.code === 'W_EVENT_GATEWAY_TARGET' ? `|${w.related?.[0] ?? ''}` : ''}`;
}

/** The op warnings without those the validator reports too (the validator's has the richer hint). */
export function opWarnings(result: MutationResult): Warning[] {
  const validationKeys = new Set(result.validation.warnings.map(findingKey));
  return result.changes.warnings.filter((w) => !validationKeys.has(findingKey(w)));
}

function layoutWarnings(layout: LayoutStatus): Warning[] {
  return layout.warnings.map((w) => ({ code: `W_LAYOUT_${w.code}`, message: w.message, element: w.elementId }));
}

/** Every warning of a mutation: op warnings (without repeats), validation warnings, layout warnings as W_LAYOUT_<code>. */
export function mutationWarnings(result: MutationResult): Warning[] {
  return [...opWarnings(result), ...result.validation.warnings, ...layoutWarnings(result.layout)];
}

/** The JSON the CLI prints for a mutation with --json. */
export function mutationReport(result: MutationResult): MutationReport {
  return {
    ok: true,
    file: result.file,
    written: result.written,
    unchanged: result.unchanged,
    created: result.changes.created,
    changed: result.changes.changed,
    removed: result.changes.removed,
    warnings: opWarnings(result),
    notes: result.changes.notes,
    layout: result.layout,
    validation: result.validation,
    importWarnings: result.importWarnings,
    ...(result.view ? { view: result.view } : {}),
  };
}

function warningLine(w: Warning): string {
  return `warning ${w.code}${w.element ? ` ${w.element}` : ''}: ${w.message}${w.hint ? `  (${w.hint})` : ''}`;
}

/** A mutation report with or without the file it was written to (applyToXml's `result` has none). */
export type MutationReportLike = Omit<MutationReport, 'file' | 'written'> & { file?: string; written?: boolean };

/**
 * The text the CLI prints for a mutation: changes, warnings, the layout
 * block, the file line (when the report names a file: written, unchanged
 * and not written, or `dryRun`), the view (--show).
 */
export function renderMutation(result: MutationReportLike, opts: { dryRun?: boolean } = {}): string {
  const changes = Object.assign(new ChangeSet(), { created: result.created, changed: result.changed, removed: result.removed, warnings: result.warnings, notes: result.notes });
  const lines: string[] = [];
  const text = renderChanges(changes).trimEnd();
  // format ops change the drawing only: their lines follow in the layout block
  const formatOnly = changes.isEmpty && !!result.layout.format?.length && !changes.notes.length && !changes.warnings.length;
  if (text && !formatOnly) lines.push(text);
  for (const w of [...result.validation.warnings, ...layoutWarnings(result.layout)]) lines.push(warningLine(w));
  lines.push(...renderLayout(result.layout));
  if (result.written) lines.push(`written: ${result.file}${result.unchanged ? ' (unchanged copy of the input)' : ''}`);
  else if (result.file && result.unchanged && !opts.dryRun) lines.push(`unchanged: ${result.file} (the result equals the file; nothing written)`);
  else if (result.file) lines.push(`dry run: ${result.file} not written${result.unchanged ? ' (unchanged)' : ''}`);
  if (result.view) lines.push('', renderView(result.view).trimEnd());
  return lines.join('\n');
}

/** `bpmn validate` as data: the layout dry run's failure counts as an error, its warnings as W_LAYOUT_<code> warnings. */
export function validationReport(check: CheckResult): ValidationReport {
  const warnings = [...check.validation.warnings, ...(check.layout.status === 'ok' ? layoutWarnings(check.layout) : [])];
  const errors = [...check.validation.errors, ...(check.layout.status === 'failed' ? [check.layout.error] : [])];
  return { ok: errors.length === 0, errors, warnings, platform: check.validation.platform, layout: check.layout, importWarnings: check.importWarnings };
}

/** The text `bpmn validate` prints. */
export function renderValidation(report: ValidationReport): string {
  const { errors, warnings, platform } = report;
  const lines: string[] = [];
  if (report.importWarnings.length) lines.push(...report.importWarnings.map((w) => `import: ${w}`));
  if (errors.length) lines.push(renderProblems(errors).trimEnd());
  if (warnings.length) lines.push(renderProblems(warnings).trimEnd());
  if (platform) {
    // only Camunda 7 has engine rules so far: a count of 0 would read as "checked and fine" for Camunda 8
    const counts =
      platform.platform === 'c7'
        ? ` - ${platform.counts.deploy} refused at deploy, ${platform.counts.runtime} runtime, ${platform.counts.practice} practice finding(s)`
        : platform.platform === 'c8'
          ? ' - no Camunda 8 engine rules yet (structure and lint only)'
          : '';
    lines.push(`platform: ${platform.platform} (${platform.detail})${counts}`);
  }
  lines.push(report.layout.status === 'ok' ? 'layout: ok' : report.layout.status === 'failed' ? `layout: failed (${report.layout.error.code})` : 'layout: skipped');
  const imported = report.importWarnings.length ? `, ${report.importWarnings.length} import warning(s)` : '';
  lines.push(errors.length ? `${errors.length} error(s), ${warnings.length} warning(s)${imported}` : `valid, ${warnings.length} warning(s)${imported}`);
  return lines.join('\n');
}
