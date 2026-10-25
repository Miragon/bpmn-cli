import type { LayoutProblem } from '../../drawing/utils/problems.js';
import type { FormatResult } from '../../format/FormatOps.js';
import type { Change, ChangeSet } from '../../model/ChangeSet.js';
import type { LayoutStatus } from '../../pipeline/index.js';
import type { Warning } from '../../shared/CliError.js';
import { INDENT, q } from './view-lines.js';

export type ChangeEntries = Pick<ChangeSet, 'created' | 'changed' | 'removed' | 'warnings' | 'notes'>;

function changeLine(verb: string, c: Change): string {
  // a flow without id (valid BPMN) that an op removed
  let line = `${verb} ${c.kind} ${c.id || '(no id)'}`;
  if (c.name) line += ` ${q(c.name)}`;
  if (c.detail) line += ` - ${c.detail}`;
  return line;
}

export function renderChanges(cs: ChangeEntries): string {
  const out: string[] = [];
  if (hasNoEntries(cs)) out.push('no changes');
  for (const c of cs.created) out.push(changeLine('created', c));
  for (const c of cs.changed) out.push(changeLine('changed', c));
  for (const c of cs.removed) out.push(changeLine('removed', c));
  for (const w of cs.warnings) out.push(`warning ${problemLine(w)}`);
  for (const n of cs.notes) out.push(`note: ${n}`);
  return out.join('\n');
}

export function hasNoEntries(cs: Pick<ChangeEntries, 'created' | 'changed' | 'removed'>): boolean {
  return !cs.created.length && !cs.changed.length && !cs.removed.length;
}

function problemLine(p: Warning): string {
  const validator = (p as Warning & { validator?: string }).validator;
  let head = validator ? `[${validator}] ${p.code}` : p.code;
  if (p.element) head += ` ${p.element}`;
  if (p.related?.length) head += ` [${p.related.join(', ')}]`;
  return `${head}: ${p.message}${p.hint ? `  (${p.hint})` : ''}`;
}

/** `[validator] CODE element [related]: message  (hint)` */
export function renderProblems(problems: Warning[]): string {
  if (!problems.length) return 'no problems';
  return problems.map(problemLine).join('\n');
}

function idList(ids: readonly string[], max = 8): string {
  return ids.length <= max ? ids.join(', ') : `${ids.slice(0, max).join(', ')} (+${ids.length - max} more)`;
}

export function problemText(p: LayoutProblem): string {
  return `${p.kind} [${p.ids.join(', ')}]${p.detail ? ` ${p.detail}` : ''}`;
}

function problemList(list: readonly LayoutProblem[], max = 6): string {
  const shown = list.slice(0, max).map(problemText).join(', ');
  return list.length > max ? `${shown} (+${list.length - max} more)` : shown;
}

/** `  format place #0: moved A, B; rerouted F; note: ...`; `--summary` prints it unindented. */
export function formatLine(f: FormatResult): string {
  const parts: string[] = [];
  if (f.colored?.length) parts.push(`colored ${idList(f.colored)}`);
  if (f.labels?.length) parts.push(`label placed ${idList(f.labels)}`);
  if (f.moved.length) parts.push(`moved ${idList(f.moved)}`);
  if (f.rerouted.length) parts.push(`rerouted ${idList(f.rerouted)}`);
  if (!parts.length) parts.push('no change');
  for (const n of f.notes ?? []) parts.push(`note: ${n}`);
  return `${INDENT}format ${f.op} #${f.index}: ${parts.join('; ')}`;
}

export function renderLayout(layout: LayoutStatus): string[] {
  const out: string[] = [];
  const warnings = layout.warnings.length ? ` (${layout.warnings.length} warning${layout.warnings.length === 1 ? '' : 's'})` : '';
  if (layout.status !== 'ok') out.push('layout: skipped');
  else out.push(`layout: ok${layout.mode ? ` - ${layout.mode}${layout.reason ? ` (${layout.reason})` : ''}` : ''}${warnings}`);
  for (const key of ['placed', 'moved', 'rerouted', 'pruned'] as const) {
    const ids = layout[key];
    if (ids?.length) out.push(`${INDENT}${key}: ${idList(ids)}`);
  }
  for (const n of layout.notes ?? []) out.push(`${INDENT}note: ${n}`);
  for (const f of layout.format ?? []) out.push(formatLine(f));
  if (layout.stickies?.length) out.push(`${INDENT}stickies moved: ${layout.stickies.map((s) => `${s.sticky} (with ${s.node})`).join(', ')}`);
  const m = layout.metrics;
  if (m) {
    const score = m.before ? `score ${m.before.score} -> ${m.after.score}` : `score ${m.after.score}`;
    const parts = [score];
    if (m.added.length) parts.push(`${m.before ? 'added' : 'problems'}: ${problemList(m.added)}`);
    if (m.resolved.length) parts.push(`resolved: ${problemList(m.resolved)}`);
    out.push(`layout quality: ${parts.join('; ')}`);
  }
  return out;
}
