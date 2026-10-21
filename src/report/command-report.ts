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
 *                             the added warnings, what validators left out, the layout score and added problems, the ids that
 *                             follow declared conventions
 *   renderSummary(summary, { dryRun, advisory })  its text
 *   validationReport(check)   the JSON of `bpmn validate` (layout failures and warnings folded in)
 *   renderValidation(report)  its text
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
import type { Warning } from '../shared/errors.js';
import { formatLine, renderChanges, renderLayout, renderProblems, renderView } from './view-text.js';
import type { CheckResult, ConventionsReport, LayoutStatus, MutationResult } from '../pipeline/index.js';
import type { PlatformSummary } from '../platform/profiles/profile.js';
import { ChangeSet, type Change } from '../model/change-set.js';
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
 * element the change removed, model/change-set.ts Rename.takeover) is no rename: the
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
    ...(result.conventions ? { conventions: result.conventions } : {}),
  };
}

/** A flood: this many warnings of one code (and validator) or more are printed as one line. */
export const FLOOD_MIN = 3;

/** How many element ids a flood line lists before `+n more`. */
const FLOOD_IDS = 30;

/** Codes whose every warning gets its own line: each hint is the command for that one element (a flood line keeps only the first). */
const NEVER_FLOOD = new Set(['W_FLOW_ID_STALE']);

function floodKey(w: Warning): string {
  return `${validatorTag(w)}${w.code}`;
}

function validatorOf(w: Warning): string | undefined {
  return (w as Warning & { validator?: string }).validator;
}

/** The names of the advisory validators of a result (`blocks: false`). */
function advisoryOf(reports: readonly ValidatorReport[] | undefined): Set<string> {
  return new Set((reports ?? []).filter((r) => r.blocks === false).map((r) => r.name));
}

function idsText(ids: string[]): string {
  return ids.length > FLOOD_IDS ? `${ids.slice(0, FLOOD_IDS).join(', ')}, +${ids.length - FLOOD_IDS} more` : ids.join(', ');
}

/**
 * One `warning ...` line per warning; FLOOD_MIN or more of one code become one
 * line at the place of the first: `warning W_UNREACHABLE x20 [A, B, ...]: <the
 * first one's message>  (<its hint>)`. The NEVER_FLOOD codes stay one line
 * each; the findings of an `advisory` validator group by code and message.
 */
export function warningLines(warnings: readonly Warning[], advisory: ReadonlySet<string> = new Set()): string[] {
  const keyOf = (w: Warning): string => {
    const v = validatorOf(w);
    return v && advisory.has(v) ? `${warningTag(w)}${w.code}\n${w.message}` : floodKey(w);
  };
  const groups = new Map<string, Warning[]>();
  for (const w of warnings) groups.set(keyOf(w), [...(groups.get(keyOf(w)) ?? []), w]);
  const out: string[] = [];
  const done = new Set<string>();
  for (const w of warnings) {
    const key = keyOf(w);
    const group = groups.get(key)!;
    if (group.length < FLOOD_MIN || NEVER_FLOOD.has(w.code)) {
      out.push(warningLine(w));
      continue;
    }
    if (done.has(key)) continue;
    done.add(key);
    const ids = group.map((g) => g.element ?? '?');
    out.push(`warning ${warningTag(w)}${w.code} x${group.length} [${idsText(ids)}]: ${w.message}${w.hint ? `  (${w.hint})` : ''}`);
  }
  return out;
}

/** What an advisory validator reports that is no rule of it: bpmn-cli's own codes about the validator and its configuration, the lint parse's import warnings. */
const NO_RULE = new Set(['W_LINT_UNAVAILABLE', 'W_LINT_FAILED', 'W_CONFIG_IGNORED', 'import-warning']);

/**
 * validate's text of errors or warnings: renderProblems, but an error of an
 * `advisory` validator reads `[bpmnlint error]`, and FLOOD_MIN or more
 * findings of one of its rules with one hint are one line at the place of
 * the first: `[bpmnlint] <rule> x12 [ids]: <the most common message> (5 of
 * 12; 7 others with 3 other messages, --json lists them)  (<the hint>)`, the
 * ids those with that message. What bpmn-cli reports about the validator
 * itself and its configuration (W_LINT_UNAVAILABLE, W_LINT_FAILED,
 * W_CONFIG_IGNORED) and import warnings are no rule: one line each.
 */
function problemLines(problems: readonly Warning[], advisory: ReadonlySet<string>): string {
  const isAdvisory = (p: Warning): boolean => {
    const v = validatorOf(p);
    return !!v && advisory.has(v);
  };
  const keyOf = (p: Warning): string | undefined => {
    if (!isAdvisory(p) || NO_RULE.has(p.code)) return undefined;
    return `${validatorOf(p)}\n${p.code}\n${p.hint ?? ''}`;
  };
  const tag = (p: Warning): string => (isAdvisory(p) ? warningTag(p) : validatorTag(p));
  const groups = new Map<string, Warning[]>();
  for (const p of problems) {
    const key = keyOf(p);
    if (key) groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  const out: string[] = [];
  const done = new Set<string>();
  for (const p of problems) {
    const key = keyOf(p);
    const group = key ? groups.get(key)! : [p];
    if (group.length < FLOOD_MIN) {
      // `[bpmnlint error] <rule> ...` for an advisory validator's error: its rule names carry no E_ / W_
      out.push(isAdvisory(p) ? renderProblems([p]).replace(validatorTag(p), tag(p)) : renderProblems([p]));
      continue;
    }
    if (done.has(key!)) continue;
    done.add(key!);
    const byMessage = new Map<string, Warning[]>();
    for (const g of group) byMessage.set(g.message, [...(byMessage.get(g.message) ?? []), g]);
    const [message, same] = [...byMessage].reduce((a, b) => (b[1].length > a[1].length ? b : a));
    const others = byMessage.size - 1;
    const rest = group.length - same.length;
    const note = others ? ` (${same.length} of ${group.length}; ${rest} other${rest === 1 ? '' : 's'} with ${others} other message${others === 1 ? '' : 's'}, --json lists them)` : '';
    // one hint per group (the key): the line's hint is every finding's
    out.push(`${tag(p)}${p.code} x${group.length} [${idsText(same.map((g) => g.element ?? '?'))}]: ${message}${note}${p.hint ? `  (${p.hint})` : ''}`);
  }
  return out.join('\n');
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

/** `[<validator>] ` for a validator's finding (src/validate/validators.ts), else ''. */
export function validatorTag(w: Warning): string {
  const name = validatorOf(w);
  return name ? `[${name}] ` : '';
}

/** validatorTag, but `[bpmnlint error] ` for an error among a write's warnings (only an advisory validator's error is there) or of an advisory validator in validate. */
function warningTag(w: Warning): string {
  const name = validatorOf(w);
  return name && (w as Warning & { severity?: string }).severity === 'error' ? `[${name} error] ` : validatorTag(w);
}

function warningLine(w: Warning): string {
  return `warning ${warningTag(w)}${w.code}${w.element ? ` ${w.element}` : ''}: ${w.message}${w.hint ? `  (${w.hint})` : ''}`;
}

/** The findings a validator left out of the comparison of a result (ValidatorReport.leftOut). */
function leftOutCount(r: ValidatorReport): number {
  return (r.leftOut ?? []).reduce((n, g) => n + g.count, 0);
}

/**
 * `7 left out (incoming / outgoing lists the file does not keep; `bpmn
 * validate <file>` lists them)`: the project's bpmnlint runs in `bpmn
 * validate`, a host's validator in the host's check.
 */
function leftOutText(validator: string, g: { reason: string; count: number }): string {
  const it = g.count === 1 ? 'it' : 'them';
  // 'bpmnlint': BPMNLINT_VALIDATOR, as validatorRefusal names it (command-report.ts does not import src/validate/bpmnlint-validator.ts)
  return `${g.count} left out (${g.reason}; ${validator === 'bpmnlint' ? `\`bpmn validate <file>\` lists ${it}` : `a check lists ${it}`})`;
}

/** The findings of an advisory validator's report of a result that the change did not add and the validator did not leave out: the file already had them. */
function keptOf(r: ValidatorReport): number {
  return r.counts.errors + r.counts.warnings - r.errors.length - r.warnings.length - leftOutCount(r);
}

/**
 * One line per validator that ran: its name, why it ran and the totals of the
 * result (`what`: result / file); an advisory validator's line of a result
 * adds how many findings the change added and resolved and how many the file
 * already had; a result's line adds how many findings the validator left out
 * of the comparison, and why (`7 left out (incoming / outgoing lists the file
 * does not keep; `bpmn validate <file>` lists them)`).
 */
function validatorLines(reports: readonly ValidatorReport[] | undefined, what: string): string[] {
  return (reports ?? []).map((r) => {
    const line = `validator ${r.name}${r.detail ? ` (${r.detail})` : ''}: ${r.counts.errors} error(s), ${r.counts.warnings} warning(s) in the ${what}`;
    if (what !== 'result') return line;
    const left = (r.leftOut ?? []).map((g) => leftOutText(r.name, g));
    if (r.blocks !== false) return left.length ? `${line} (${left.join(', ')})` : line;
    return `${line} (${[`${r.errors.length + r.warnings.length} added`, `${r.resolved.length} resolved`, `${keptOf(r)} already in the file`, ...left].join(', ')})`;
  });
}

/** A mutation report with or without the file it was written to (applyToXml's `result` has none). */
export type MutationReportLike = Omit<MutationReport, 'file' | 'written'> & { file?: string; written?: boolean };

/**
 * The text the CLI prints for a mutation: changes, warnings, the validator
 * lines, the conventions line, the layout block, the file line (when the
 * report names a file: written, unchanged and not written, or `dryRun`),
 * the view (--show).
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
  lines.push(...warningLines(result.warnings.added, advisoryOf(result.validation.validators)));
  if (result.warnings.resolved.length) lines.push(`resolved: ${findingList(result.warnings.resolved)}`);
  if (result.warnings.preexistingCount) lines.push(preexistingLine(result.warnings.preexistingCount));
  lines.push(...validatorLines(result.validation.validators, 'result'));
  lines.push(...conventionsLines(result.conventions));
  lines.push(...renderLayout(result.layout));
  lines.push(...fileLines(result, opts));
  if (result.view) lines.push('', renderView(result.view).trimEnd());
  return lines.join('\n');
}

/**
 * `conventions: serviceTask_bookOrder, flow_checkOrderToBookOrder follow
 * element-id-naming (.bpmnlintrc in .), not the file's own id style`: only
 * for new ids under a prefix the declared conventions name, where they
 * differ from what the file's own style would give.
 */
export function conventionsLines(c: ConventionsReport | undefined): string[] {
  if (!c?.ids.length) return [];
  const ids = c.ids.length > FLOOD_IDS ? `${c.ids.slice(0, FLOOD_IDS).join(', ')}, +${c.ids.length - FLOOD_IDS} more` : c.ids.join(', ');
  return [`conventions: ${ids} follow${c.ids.length === 1 ? 's' : ''} element-id-naming (${c.source ?? 'the host'}), not the file's own id style  (\`bpmn show <file> --conventions\`)`];
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

/** The ids of the entries, once each (an entry without id, a removed flow that had none, names nothing to use). */
function uniqueIds(changes: readonly Change[]): string[] {
  return [...new Set(changes.map((c) => c.id).filter(Boolean))];
}

/** The summary of a mutation report (`--summary`; also of applyToXml's `result`). */
export function mutationSummary(report: MutationReportLike): MutationSummary {
  const created: Record<string, string[]> = {};
  for (const c of report.created) {
    const ids = (created[c.kind] ??= []);
    if (!ids.includes(c.id)) ids.push(c.id);
  }
  const m = report.layout.metrics;
  const left = (report.validation.validators ?? []).flatMap((r) => (r.leftOut ?? []).map((g) => ({ validator: r.name, ...g })));
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
    // the summary prints no validator line: an advisory validator's old findings are counted here
    warnings: { added: report.warnings.added, resolvedCount: report.warnings.resolved.length, preexistingCount: report.warnings.preexistingCount + (report.validation.validators ?? []).filter((r) => r.blocks === false).reduce((n, r) => n + keptOf(r), 0) },
    // what no count above has: the findings a validator did not compare (bpmnlint in CI reports them)
    ...(left.length ? { leftOut: left } : {}),
    layout: {
      status: report.layout.status,
      ...(report.layout.mode ? { mode: report.layout.mode } : {}),
      ...(m ? { score: { ...(m.before ? { before: m.before.score } : {}), after: m.after.score } } : {}),
      ...(m?.before && m.added.length ? { added: m.added } : {}),
      ...(m && !m.before && m.added.length ? { problems: m.added.length } : {}),
    },
    ...(report.layout.format?.length ? { format: report.layout.format } : {}),
    ...(report.conventions ? { conventions: report.conventions } : {}),
  };
}

/** The summary's left-out findings by validator, in their order. */
function groupLeftOut(left: MutationSummary['leftOut']): Map<string, Array<{ reason: string; count: number }>> {
  const out = new Map<string, Array<{ reason: string; count: number }>>();
  for (const { validator, reason, count } of left ?? []) out.set(validator, [...(out.get(validator) ?? []), { reason, count }]);
  return out;
}

/**
 * The text of `--summary`: `created <kind>: ids` per kind, `aliases:`,
 * `changed:`, `renamed: old -> new` and `removed:` ids, one `format <op> #<i>: ...` line per format op, forced
 * errors, the added warnings (floods as one line; `advisory`: the names of
 * the advisory validators, whose findings group by code and message),
 * `warnings: n added, n resolved, n already in the file`, what a validator
 * left out (`validator bpmnlint: 7 left out (incoming / outgoing lists the
 * file does not keep; `bpmn validate <file>` lists them)`), one layout line
 * (`layout: incremental, score 12 -> 14; added: crossings [Flow_1, Flow_3]`),
 * the conventions line and the file line.
 */
export function renderSummary(summary: MutationSummary, opts: { dryRun?: boolean; advisory?: ReadonlySet<string> } = {}): string {
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
  lines.push(...warningLines(summary.warnings.added, opts.advisory));
  const w = summary.warnings;
  if (w.added.length || w.resolvedCount || w.preexistingCount) lines.push(`warnings: ${w.added.length} added, ${w.resolvedCount} resolved, ${w.preexistingCount} already in the file`);
  for (const [validator, groups] of groupLeftOut(summary.leftOut)) lines.push(`validator ${validator}: ${groups.map((g) => leftOutText(validator, g)).join(', ')}`);
  const l = summary.layout;
  const parts = [l.status === 'ok' ? `layout: ${l.mode ?? 'ok'}` : 'layout: skipped'];
  if (l.score) parts.push(l.score.before !== undefined ? `score ${l.score.before} -> ${l.score.after}` : `score ${l.score.after}`);
  const head = parts.join(', ');
  if (l.added?.length) lines.push(`${head}; added: ${l.added.map((p) => `${p.kind} [${p.ids.join(', ')}]`).join(', ')}`);
  else if (l.problems) lines.push(`${head} (${l.problems} layout problem${l.problems === 1 ? '' : 's'}: \`bpmn metrics <file>\` lists them)`);
  else lines.push(head);
  lines.push(...conventionsLines(summary.conventions));
  lines.push(...fileLines(summary, opts));
  return lines.join('\n');
}

/** `bpmn validate` as data: the layout dry run's failure counts as an error, its warnings as W_LAYOUT_<code> warnings. */
export function validationReport(check: CheckResult): ValidationReport {
  const warnings = [...check.validation.warnings, ...(check.layout.status === 'ok' ? layoutWarnings(check.layout) : [])];
  const errors = [...check.validation.errors, ...(check.layout.status === 'failed' ? [check.layout.error] : [])];
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    platform: check.validation.platform,
    ...(check.validation.validators ? { validators: check.validation.validators } : {}),
    layout: check.layout,
    importWarnings: check.importWarnings,
  };
}

/** The names of the advisory validators of a mutation report (renderSummary's `advisory`). */
export function advisoryValidators(report: Pick<MutationReportLike, 'validation'>): Set<string> {
  return advisoryOf(report.validation.validators);
}

/** The text `bpmn validate` prints. */
export function renderValidation(report: ValidationReport): string {
  const { errors, warnings, platform } = report;
  const lines: string[] = [];
  if (report.importWarnings.length) lines.push(...report.importWarnings.map((w) => `import: ${w}`));
  const advisory = advisoryOf(report.validators);
  if (errors.length) lines.push(problemLines(errors, advisory).trimEnd());
  if (warnings.length) lines.push(problemLines(warnings, advisory).trimEnd());
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
