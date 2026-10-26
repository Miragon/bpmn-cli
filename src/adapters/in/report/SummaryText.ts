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
    if (summary.renamed) lines.push(`renamed: ${Object.entries(summary.renamed).map(([from, to]) => `${from} -> ${to}`).join(', ')}`);
    if (summary.removed.length) lines.push(`removed: ${summary.removed.join(', ')}`);
    for (const format of summary.format ?? []) lines.push(formatLine(format).trimStart());
    if (!lines.length) lines.push('no changes');
    for (const error of summary.forced ?? []) lines.push(`forced ${validatorTag(error)}${error.code}${error.element ? ` ${error.element}` : ''}: ${error.message}`);
    lines.push(...new WarningLines(opts.advisory).lines(summary.warnings.added));
    const warnings = summary.warnings;
    if (warnings.added.length || warnings.resolvedCount || warnings.preexistingCount) lines.push(`warnings: ${warnings.added.length} added, ${warnings.resolvedCount} resolved, ${warnings.preexistingCount} already in the file`);
    for (const [validator, groups] of SummaryText.groupLeftOut(summary.leftOut)) lines.push(`validator ${validator}: ${groups.map((group) => leftOutText(validator, group)).join(', ')}`);
    const layout = summary.layout;
    const parts = [layout.status === 'ok' ? `layout: ${layout.mode ?? 'ok'}` : 'layout: skipped'];
    if (layout.score) parts.push(layout.score.before !== undefined ? `score ${layout.score.before} -> ${layout.score.after}` : `score ${layout.score.after}`);
    const head = parts.join(', ');
    if (layout.added?.length) lines.push(`${head}; added: ${layout.added.map((placed) => `${placed.kind} [${placed.ids.join(', ')}]`).join(', ')}`);
    else if (layout.problems) lines.push(`${head} (${layout.problems} layout problem${layout.problems === 1 ? '' : 's'}: \`bpmn metrics <file>\` lists them)`);
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
