import type { MutationSummary } from './command-report.js';
import { WarningLines } from './WarningLines.js';
import { validatorTag } from './utils/findings.js';
import { aliasLine, conventionsLines, fileLines, leftOutText } from './utils/mutation-lines.js';
import { formatLine } from './utils/result-lines.js';

/**
 * The text of `--summary`: created / changed / renamed / removed ids, format ops, forced errors,
 * the added warnings, a warnings count line, one layout line, the conventions and file lines.
 */
export class SummaryText {
  constructor(
    private readonly summary: MutationSummary,
    private readonly opts: { dryRun?: boolean; advisory?: ReadonlySet<string> } = {},
  ) {}

  text(): string {
    const { summary, opts } = this;
    const lines: string[] = [];
    for (const [kind, ids] of Object.entries(summary.created)) lines.push(`created ${kind}: ${ids.join(', ')}`);
    if (summary.aliases) lines.push(aliasLine(summary.aliases));
    if (summary.changed.length) lines.push(`changed: ${summary.changed.join(', ')}`);
    // a later command must use the new id: say which old one it replaces
    if (summary.renamed) lines.push(`renamed: ${Object.entries(summary.renamed).map(([a, b]) => `${a} -> ${b}`).join(', ')}`);
    if (summary.removed.length) lines.push(`removed: ${summary.removed.join(', ')}`);
    for (const f of summary.format ?? []) lines.push(formatLine(f).trimStart());
    if (!lines.length) lines.push('no changes');
    for (const e of summary.forced ?? []) lines.push(`forced ${validatorTag(e)}${e.code}${e.element ? ` ${e.element}` : ''}: ${e.message}`);
    lines.push(...new WarningLines(opts.advisory).lines(summary.warnings.added));
    const w = summary.warnings;
    if (w.added.length || w.resolvedCount || w.preexistingCount) lines.push(`warnings: ${w.added.length} added, ${w.resolvedCount} resolved, ${w.preexistingCount} already in the file`);
    for (const [validator, groups] of SummaryText.groupLeftOut(summary.leftOut)) lines.push(`validator ${validator}: ${groups.map((g) => leftOutText(validator, g)).join(', ')}`);
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

  private static groupLeftOut(left: MutationSummary['leftOut']): Map<string, Array<{ reason: string; count: number }>> {
    const out = new Map<string, Array<{ reason: string; count: number }>>();
    for (const { validator, reason, count } of left ?? []) out.set(validator, [...(out.get(validator) ?? []), { reason, count }]);
    return out;
  }
}
