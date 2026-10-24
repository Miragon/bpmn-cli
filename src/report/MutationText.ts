import type { MutationReportLike } from './command-report.js';
import { WarningLines } from './WarningLines.js';
import { advisoryOf, findingList, validatorTag } from './utils/findings.js';
import { aliasLine, conventionsLines, fileLines, validatorLines } from './utils/mutation-lines.js';
import { hasNoEntries, renderChanges, renderLayout } from './utils/result-lines.js';
import { ModelViewText } from './ModelViewText.js';

/**
 * The text the CLI prints for a mutation: changes, warnings, the validator
 * lines, the conventions line, the layout block, the file line (when the
 * report names a file: written, unchanged and not written, or `dryRun`),
 * the view (--show).
 */
export class MutationText {
  constructor(
    private readonly result: MutationReportLike,
    private readonly opts: { dryRun?: boolean } = {},
  ) {}

  text(): string {
    const result = this.result;
    const lines: string[] = [];
    const text = renderChanges({ created: result.created, changed: result.changed, removed: result.removed, warnings: [], notes: result.notes }).trimEnd();
    // format ops change the drawing only: their lines follow in the layout block
    const formatOnly = hasNoEntries(result) && !!result.layout.format?.length && !result.notes.length;
    if (text && !formatOnly) lines.push(text);
    if (result.aliases && Object.keys(result.aliases).length) lines.push(aliasLine(result.aliases));
    // errors only remain in a result written with --force
    for (const e of result.validation.errors) lines.push(`forced ${validatorTag(e)}${e.code}${e.element ? ` ${e.element}` : ''}: ${e.message}`);
    lines.push(...new WarningLines(advisoryOf(result.validation.validators)).lines(result.warnings.added));
    if (result.warnings.resolved.length) lines.push(`resolved: ${findingList(result.warnings.resolved)}`);
    if (result.warnings.preexistingCount) lines.push(MutationText.preexistingLine(result.warnings.preexistingCount));
    lines.push(...validatorLines(result.validation.validators, 'result'));
    lines.push(...conventionsLines(result.conventions));
    lines.push(...renderLayout(result.layout));
    lines.push(...fileLines(result, this.opts));
    if (result.view) lines.push('', new ModelViewText(result.view).text().trimEnd());
    return lines.join('\n');
  }

  /** `12 warnings already in the file (not repeated: `bpmn validate <file>` lists them)` */
  private static preexistingLine(count: number): string {
    return `${count} warning${count === 1 ? '' : 's'} already in the file (not repeated: \`bpmn validate <file>\` lists them)`;
  }
}
