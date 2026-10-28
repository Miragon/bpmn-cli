import type { LayoutProblem } from '../../../../domain/diagram/utils/problems.js';
import type { DiagramCommandResult } from '../../../../domain/diagram/commands/DiagramCommands.js';
import type { Change, ChangeSet } from '../../../../domain/document/ChangeSet.js';
import type { LayoutStatus } from '../../../../domain/diagram/types.js';
import type { Finding } from '../../../../domain/document/Finding.js';
import { INDENT, quote } from './view-lines.js';

export type ChangeEntries = Pick<ChangeSet, 'created' | 'changed' | 'removed' | 'warnings' | 'notes'>;

/** A flow without id (valid BPMN) that an op removed reads `(no id)`. */
function changeLine(verb: string, change: Change): string {
  let line = `${verb} ${change.kind} ${change.id || '(no id)'}`;
  if (change.name) line += ` ${quote(change.name)}`;
  if (change.detail) line += ` - ${change.detail}`;
  return line;
}

export function renderChanges(cs: ChangeEntries): string {
  const out: string[] = [];
  if (hasNoEntries(cs)) out.push('no changes');
  for (const change of cs.created) out.push(changeLine('created', change));
  for (const change of cs.changed) out.push(changeLine('changed', change));
  for (const change of cs.removed) out.push(changeLine('removed', change));
  for (const warning of cs.warnings) out.push(`warning ${problemLine(warning)}`);
  for (const note of cs.notes) out.push(`note: ${note}`);
  return out.join('\n');
}

export function hasNoEntries(cs: Pick<ChangeEntries, 'created' | 'changed' | 'removed'>): boolean {
  return !cs.created.length && !cs.changed.length && !cs.removed.length;
}

function problemLine(problem: Finding): string {
  const { validator } = problem;
  let head = validator ? `[${validator}] ${problem.code}` : problem.code;
  if (problem.element) head += ` ${problem.element}`;
  if (problem.related?.length) head += ` [${problem.related.join(', ')}]`;
  return `${head}: ${problem.message}${problem.hint ? `  (${problem.hint})` : ''}`;
}

/** `[validator] CODE element [related]: message  (hint)` */
export function renderProblems(problems: Finding[]): string {
  if (!problems.length) return 'no problems';
  return problems.map(problemLine).join('\n');
}

function idList(ids: readonly string[], max = 8): string {
  return ids.length <= max ? ids.join(', ') : `${ids.slice(0, max).join(', ')} (+${ids.length - max} more)`;
}

export function problemText(problem: LayoutProblem): string {
  return `${problem.kind} [${problem.ids.join(', ')}]${problem.detail ? ` ${problem.detail}` : ''}`;
}

function problemList(list: readonly LayoutProblem[], max = 6): string {
  const shown = list.slice(0, max).map(problemText).join(', ');
  return list.length > max ? `${shown} (+${list.length - max} more)` : shown;
}

/** `  format place #0: moved A, B; rerouted F; note: ...`; `--summary` prints it unindented. */
export function formatLine(format: DiagramCommandResult): string {
  const parts: string[] = [];
  if (format.colored?.length) parts.push(`colored ${idList(format.colored)}`);
  if (format.labels?.length) parts.push(`label placed ${idList(format.labels)}`);
  if (format.moved.length) parts.push(`moved ${idList(format.moved)}`);
  if (format.rerouted.length) parts.push(`rerouted ${idList(format.rerouted)}`);
  if (!parts.length) parts.push('no change');
  for (const note of format.notes ?? []) parts.push(`note: ${note}`);
  return `${INDENT}format ${format.op} #${format.index}: ${parts.join('; ')}`;
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
  for (const note of layout.notes ?? []) out.push(`${INDENT}note: ${note}`);
  for (const format of layout.format ?? []) out.push(formatLine(format));
  if (layout.stickies?.length) out.push(`${INDENT}stickies moved: ${layout.stickies.map((sticky) => `${sticky.sticky} (with ${sticky.node})`).join(', ')}`);
  const metrics = layout.metrics;
  if (metrics) {
    const score = metrics.before ? `score ${metrics.before.score} -> ${metrics.after.score}` : `score ${metrics.after.score}`;
    const parts = [score];
    if (metrics.added.length) parts.push(`${metrics.before ? 'added' : 'problems'}: ${problemList(metrics.added)}`);
    if (metrics.resolved.length) parts.push(`resolved: ${problemList(metrics.resolved)}`);
    out.push(`layout quality: ${parts.join('; ')}`);
  }
  return out;
}
