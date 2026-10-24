import type { MutationSummary } from './command-report.js';
import { WarningLines } from './WarningLines.js';
import { validatorTag } from './utils/findings.js';
import { aliasLine, conventionsLines, fileLines, leftOutText } from './utils/mutation-lines.js';
import { formatLine } from './utils/result-lines.js';

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
    // a format op changes the drawing only: its line says what it moved (or why it did not)
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

  /** The summary's left-out findings by validator, in their order. */
  private static groupLeftOut(left: MutationSummary['leftOut']): Map<string, Array<{ reason: string; count: number }>> {
    const out = new Map<string, Array<{ reason: string; count: number }>>();
    for (const { validator, reason, count } of left ?? []) out.set(validator, [...(out.get(validator) ?? []), { reason, count }]);
    return out;
  }
}
