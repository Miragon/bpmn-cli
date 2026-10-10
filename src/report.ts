/**
 * What a command reports, as data and as text: the same for the CLI (its
 * `--json` output and its text output) and for the in-memory API
 * (src/api.ts), so a host that embeds the library hands its agent exactly
 * what the CLI would print.
 *
 *   opWarnings(result)        the op warnings without the ones the validator repeats
 *   mutationWarnings(result)  every warning of a mutation (what --strict counts)
 *   mutationReport(result)    the JSON of a mutation (no XML): warnings as a delta
 *                             (added / resolved / preexistingCount), not every warning of the file
 *   renderMutation(report, { dryRun })  its text (also of applyToXml's `result`)
 *   mutationSummary(report)   `--summary`: created ids by kind, batch aliases, changed / renamed / removed ids, the format ops,
 *                             the added warnings, the layout score and added problems
 *   renderSummary(summary, { dryRun })  its text
 *   validationReport(check)   the JSON of `bpmn validate` (layout failures and warnings folded in)
 *   renderValidation(report)  its text
 */
import type { LayoutProblem } from './diagram/metrics.js';
import type { FormatResult } from './diagram/ops.js';
import type { Warning } from './errors.js';
import { formatLine, renderChanges, renderLayout, renderProblems, renderView } from './format.js';
import type { CheckResult, LayoutStatus, MutationResult } from './pipeline.js';
import type { PlatformSummary } from './platform/profile.js';
import type { ProfileInfo } from './platform/repo.js';
import { ChangeSet, type Change } from './result.js';
import type { ValidationResult } from './validate.js';
import type { ValidatorReport } from './validators.js';
import type { ModelView } from './view.js';

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
  /** ids the change renamed (a flow whose id named its old ends, renamed after its new ones): old id -> new id */
  renamed?: Record<string, string>;
  layout: LayoutStatus;
  /** errors a forced write let through, the platform summary and the validators that ran; the warnings are in `warnings` */
  validation: Omit<ValidationResult, 'warnings'>;
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
  /** the validation profile that ran, or why none did (`--profile`; the repository's model ids left out) */
  profile: Omit<ProfileInfo, 'repo'>;
  /** the validators that ran (the design profile, host validators): every finding of each; they are among errors / warnings too */
  validators?: ValidatorReport[];
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

/**
 * old id -> final id of what the ops renamed of the file's elements (a chain
 * A -> B -> C as A -> C); absent without renames. A takeover (the id of an
 * element the change removed, result.ts Rename.takeover) is no rename: the
 * old id is listed as removed, the taken one as changed.
 */
function renamedIds(result: MutationResult): Record<string, string> | undefined {
  const out = new Map<string, string>();
  for (const { from, to, takeover } of result.changes.renames ?? []) {
    if (takeover) {
      for (const [old, now] of out) if (now === from) out.delete(old);
      continue;
    }
    let chained = false;
    for (const [old, now] of out) {
      if (now !== from) continue;
      out.set(old, to);
      chained = true;
    }
    if (!chained) out.set(from, to);
  }
  // an element the change created is listed under its final id; only ids the file had before count
  const created = new Set(result.changes.created.map((c) => c.id));
  for (const [old, now] of out) if (old === now || created.has(now)) out.delete(old);
  return out.size ? Object.fromEntries(out) : undefined;
}

/** The JSON the CLI prints for a mutation with --json. */
export function mutationReport(result: MutationResult): MutationReport {
  // a result built without the pipeline's delta reports every validation warning as added
  const delta = result.delta ?? { added: result.validation.warnings, resolved: [], preexisting: 0 };
  const { warnings: _all, ...validation } = result.validation;
  const renamed = renamedIds(result);
  return {
    ok: true,
    file: result.file,
    written: result.written,
    unchanged: result.unchanged,
    created: result.changes.created,
    changed: result.changes.changed,
    removed: result.changes.removed,
    warnings: { added: [...opWarnings(result), ...delta.added, ...layoutWarnings(result.layout)], resolved: delta.resolved, preexistingCount: delta.preexisting },
    notes: result.changes.notes,
    ...(result.aliases ? { aliases: result.aliases } : {}),
    ...(renamed ? { renamed } : {}),
    layout: result.layout,
    validation,
    importWarnings: result.importWarnings,
    ...(result.view ? { view: result.view } : {}),
  };
}

/** A flood: this many warnings of one code (and validator) or more are printed as one line. */
export const FLOOD_MIN = 3;

/** How many element ids a flood line lists before `+n more`. */
const FLOOD_IDS = 30;

function floodKey(w: Warning): string {
  return `${validatorTag(w)}${w.code}`;
}

function idsText(ids: string[]): string {
  return ids.length > FLOOD_IDS ? `${ids.slice(0, FLOOD_IDS).join(', ')}, +${ids.length - FLOOD_IDS} more` : ids.join(', ');
}

/**
 * One `warning ...` line per warning; FLOOD_MIN or more of one code become one
 * line at the place of the first: `warning W_UNREACHABLE x20 [A, B, ...]: <the
 * first one's message>  (<its hint>)`.
 */
export function warningLines(warnings: readonly Warning[]): string[] {
  const groups = new Map<string, Warning[]>();
  for (const w of warnings) groups.set(floodKey(w), [...(groups.get(floodKey(w)) ?? []), w]);
  const out: string[] = [];
  const done = new Set<string>();
  for (const w of warnings) {
    const key = floodKey(w);
    const group = groups.get(key)!;
    if (group.length < FLOOD_MIN) {
      out.push(warningLine(w));
      continue;
    }
    if (done.has(key)) continue;
    done.add(key);
    const ids = group.map((g) => g.element ?? '?');
    out.push(`warning ${key} x${group.length} [${idsText(ids)}]: ${w.message}${w.hint ? `  (${w.hint})` : ''}`);
  }
  return out;
}

/** `W_DEAD_END Activity_A, W_UNREACHABLE x5 [A, B, C, D, E]`: findings by code, compact. */
export function findingList(findings: readonly Warning[]): string {
  const groups = new Map<string, Warning[]>();
  for (const f of findings) groups.set(floodKey(f), [...(groups.get(floodKey(f)) ?? []), f]);
  return [...groups]
    .map(([key, group]) => (group.length === 1 ? `${key}${group[0]!.element ? ` ${group[0]!.element}` : ''}` : `${key} x${group.length} [${idsText(group.map((g) => g.element ?? '?'))}]`))
    .join(', ');
}

/** `12 warnings already in the file (not repeated: `bpmn validate <file>` lists them)` */
function preexistingLine(count: number): string {
  return `${count} warning${count === 1 ? '' : 's'} already in the file (not repeated: \`bpmn validate <file>\` lists them)`;
}

/** `[design] ` for a validator's finding (src/validators.ts), else ''. */
export function validatorTag(w: Warning): string {
  const name = (w as Warning & { validator?: string }).validator;
  return name ? `[${name}] ` : '';
}

function warningLine(w: Warning): string {
  return `warning ${validatorTag(w)}${w.code}${w.element ? ` ${w.element}` : ''}: ${w.message}${w.hint ? `  (${w.hint})` : ''}`;
}

/** One line per validator that ran: its name, why it ran and the totals of the result (`what`: result / file). */
function validatorLines(reports: readonly ValidatorReport[] | undefined, what: string): string[] {
  return (reports ?? []).map((r) => `validator ${r.name}${r.detail ? ` (${r.detail})` : ''}: ${r.counts.errors} error(s), ${r.counts.warnings} warning(s) in the ${what}`);
}

/** A mutation report with or without the file it was written to (applyToXml's `result` has none). */
export type MutationReportLike = Omit<MutationReport, 'file' | 'written'> & { file?: string; written?: boolean };

/**
 * The text the CLI prints for a mutation: changes, warnings, the layout
 * block, the file line (when the report names a file: written, unchanged
 * and not written, or `dryRun`), the view (--show).
 */
export function renderMutation(result: MutationReportLike, opts: { dryRun?: boolean } = {}): string {
  const changes = Object.assign(new ChangeSet(), { created: result.created, changed: result.changed, removed: result.removed, warnings: [], notes: result.notes });
  const lines: string[] = [];
  const text = renderChanges(changes).trimEnd();
  // format ops change the drawing only: their lines follow in the layout block
  const formatOnly = changes.isEmpty && !!result.layout.format?.length && !changes.notes.length;
  if (text && !formatOnly) lines.push(text);
  if (result.aliases && Object.keys(result.aliases).length) lines.push(aliasLine(result.aliases));
  // errors only remain in a result written with --force
  for (const e of result.validation.errors) lines.push(`forced ${validatorTag(e)}${e.code}${e.element ? ` ${e.element}` : ''}: ${e.message}`);
  lines.push(...warningLines(result.warnings.added));
  if (result.warnings.resolved.length) lines.push(`resolved: ${findingList(result.warnings.resolved)}`);
  if (result.warnings.preexistingCount) lines.push(preexistingLine(result.warnings.preexistingCount));
  lines.push(...validatorLines(result.validation.validators, 'result'));
  lines.push(...renderLayout(result.layout));
  lines.push(...fileLines(result, opts));
  if (result.view) lines.push('', renderView(result.view).trimEnd());
  return lines.join('\n');
}

/** `aliases: $check = Activity_CheckInvoice, $ok = Gateway_InvoiceOk` */
function aliasLine(aliases: Record<string, string>): string {
  return `aliases: ${Object.entries(aliases).map(([a, id]) => `${a} = ${id}`).join(', ')}`;
}

/** The file line of a result: written / unchanged / dry run. */
function fileLines(result: { file?: string; written?: boolean; unchanged: boolean }, opts: { dryRun?: boolean }): string[] {
  if (result.written) return [`written: ${result.file}${result.unchanged ? ' (unchanged copy of the input)' : ''}`];
  if (result.file && result.unchanged && !opts.dryRun) return [`unchanged: ${result.file} (the result equals the file; nothing written)`];
  if (result.file) return [`dry run: ${result.file} not written${result.unchanged ? ' (unchanged)' : ''}`];
  return [];
}

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
  warnings: { added: Warning[]; resolvedCount: number; preexistingCount: number };
  /**
   * the layout that ran, the score before -> after, the layout problems the
   * change added; without a drawing before, only how many problems the
   * result has (`bpmn metrics` lists them)
   */
  layout: { status: 'ok' | 'skipped'; mode?: 'full' | 'incremental'; score?: { before?: number; after: number }; added?: LayoutProblem[]; problems?: number };
  /** what each format op (place, align, color, compact, lane / pool order, ...) did to the drawing, in batch order */
  format?: FormatResult[];
}

function uniqueIds(changes: readonly Change[]): string[] {
  return [...new Set(changes.map((c) => c.id))];
}

/** The summary of a mutation report (`--summary`; also of applyToXml's `result`). */
export function mutationSummary(report: MutationReportLike): MutationSummary {
  const created: Record<string, string[]> = {};
  for (const c of report.created) {
    const ids = (created[c.kind] ??= []);
    if (!ids.includes(c.id)) ids.push(c.id);
  }
  const m = report.layout.metrics;
  return {
    ok: true,
    ...(report.file !== undefined ? { file: report.file } : {}),
    ...(report.written !== undefined ? { written: report.written } : {}),
    unchanged: report.unchanged,
    created,
    ...(report.aliases && Object.keys(report.aliases).length ? { aliases: report.aliases } : {}),
    // an element the change created is listed once, as created (a lane it got, a property an op of the batch set: its full report says)
    changed: uniqueIds(report.changed).filter((id) => !report.created.some((c) => c.id === id)),
    ...(report.renamed ? { renamed: report.renamed } : {}),
    removed: uniqueIds(report.removed),
    ...(report.validation.errors.length ? { forced: report.validation.errors } : {}),
    warnings: { added: report.warnings.added, resolvedCount: report.warnings.resolved.length, preexistingCount: report.warnings.preexistingCount },
    layout: {
      status: report.layout.status,
      ...(report.layout.mode ? { mode: report.layout.mode } : {}),
      ...(m ? { score: { ...(m.before ? { before: m.before.score } : {}), after: m.after.score } } : {}),
      ...(m?.before && m.added.length ? { added: m.added } : {}),
      ...(m && !m.before && m.added.length ? { problems: m.added.length } : {}),
    },
    ...(report.layout.format?.length ? { format: report.layout.format } : {}),
  };
}

/**
 * The text of `--summary`: `created <kind>: ids` per kind, `aliases:`,
 * `changed:`, `renamed: old -> new` and `removed:` ids, one `format <op> #<i>: ...` line per format op, forced
 * errors, the added warnings (floods as one line),
 * `warnings: n added, n resolved, n already in the file`, one layout line
 * (`layout: incremental, score 12 -> 14; added: crossings [Flow_1, Flow_3]`)
 * and the file line.
 */
export function renderSummary(summary: MutationSummary, opts: { dryRun?: boolean } = {}): string {
  const lines: string[] = [];
  for (const [kind, ids] of Object.entries(summary.created)) lines.push(`created ${kind}: ${ids.join(', ')}`);
  if (summary.aliases) lines.push(aliasLine(summary.aliases));
  if (summary.changed.length) lines.push(`changed: ${summary.changed.join(', ')}`);
  // a later command must use the new id: say which old one it replaces
  if (summary.renamed) lines.push(`renamed: ${Object.entries(summary.renamed).map(([a, b]) => `${a} -> ${b}`).join(', ')}`);
  if (summary.removed.length) lines.push(`removed: ${summary.removed.join(', ')}`);
  // a format op changes the drawing only: its line says what it moved (or why it did not)
  for (const f of summary.format ?? []) lines.push(formatLine(f).trimStart());
  if (!lines.length) lines.push('no changes');
  for (const e of summary.forced ?? []) lines.push(`forced ${validatorTag(e)}${e.code}${e.element ? ` ${e.element}` : ''}: ${e.message}`);
  lines.push(...warningLines(summary.warnings.added));
  const w = summary.warnings;
  if (w.added.length || w.resolvedCount || w.preexistingCount) lines.push(`warnings: ${w.added.length} added, ${w.resolvedCount} resolved, ${w.preexistingCount} already in the file`);
  const l = summary.layout;
  const parts = [l.status === 'ok' ? `layout: ${l.mode ?? 'ok'}` : 'layout: skipped'];
  if (l.score) parts.push(l.score.before !== undefined ? `score ${l.score.before} -> ${l.score.after}` : `score ${l.score.after}`);
  const head = parts.join(', ');
  if (l.added?.length) lines.push(`${head}; added: ${l.added.map((p) => `${p.kind} [${p.ids.join(', ')}]`).join(', ')}`);
  else if (l.problems) lines.push(`${head} (${l.problems} layout problem${l.problems === 1 ? '' : 's'}: \`bpmn metrics <file>\` lists them)`);
  else lines.push(head);
  lines.push(...fileLines(summary, opts));
  return lines.join('\n');
}

/** `bpmn validate` as data: the layout dry run's failure counts as an error, its warnings as W_LAYOUT_<code> warnings. */
export function validationReport(check: CheckResult): ValidationReport {
  const warnings = [...check.validation.warnings, ...(check.layout.status === 'ok' ? layoutWarnings(check.layout) : [])];
  const errors = [...check.validation.errors, ...(check.layout.status === 'failed' ? [check.layout.error] : [])];
  const { repo: _repo, ...profile } = check.profile;
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    platform: check.validation.platform,
    profile,
    ...(check.validation.validators ? { validators: check.validation.validators } : {}),
    layout: check.layout,
    importWarnings: check.importWarnings,
  };
}

/** The text `bpmn validate` prints. */
export function renderValidation(report: ValidationReport): string {
  const { errors, warnings, platform } = report;
  const lines: string[] = [];
  if (report.importWarnings.length) lines.push(...report.importWarnings.map((w) => `import: ${w}`));
  if (errors.length) lines.push(renderProblems(errors).trimEnd());
  if (warnings.length) lines.push(renderProblems(warnings).trimEnd());
  if (platform) {
    // plain BPMN has no engine rules: a count of 0 would read as "checked and fine"
    const counts = platform.platform === 'c7' || platform.platform === 'c8' ? ` - ${platform.counts.deploy} refused at deploy, ${platform.counts.runtime} runtime, ${platform.counts.practice} practice finding(s)` : '';
    lines.push(`platform: ${platform.platform} (${platform.detail})${counts}`);
  }
  lines.push(...validatorLines(report.validators, 'file'));
  lines.push(report.layout.status === 'ok' ? 'layout: ok' : report.layout.status === 'failed' ? `layout: failed (${report.layout.error.code})` : 'layout: skipped');
  const imported = report.importWarnings.length ? `, ${report.importWarnings.length} import warning(s)` : '';
  lines.push(errors.length ? `${errors.length} error(s), ${warnings.length} warning(s)${imported}` : `valid, ${warnings.length} warning(s)${imported}`);
  return lines.join('\n');
}
