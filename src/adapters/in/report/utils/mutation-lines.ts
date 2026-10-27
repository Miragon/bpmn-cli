import type { ConventionsReport } from '../../../../domain/batch/types.js';
import type { ValidatorReport } from '../../../../domain/validation/validators.js';
import { FLOOD_IDS } from './findings.js';

function leftOutCount(report: ValidatorReport): number {
  return (report.leftOut ?? []).reduce((sum, group) => sum + group.count, 0);
}

/**
 * `7 left out (incoming / outgoing lists the file does not keep; ...)`
 * 'bpmnlint' is BPMNLINT_VALIDATOR spelled out: the report does not import the validator.
 */
export function leftOutText(validator: string, group: { reason: string; count: number }): string {
  const it = group.count === 1 ? 'it' : 'them';
  return `${group.count} left out (${group.reason}; ${validator === 'bpmnlint' ? `\`bpmn validate <file>\` lists ${it}` : `a check lists ${it}`})`;
}

/** Neither added by the change nor left out: the file already had them. */
export function keptOf(report: ValidatorReport): number {
  return report.counts.errors + report.counts.warnings - report.errors.length - report.warnings.length - leftOutCount(report);
}

/**
 * An advisory validator's line of a result adds how many findings the change added and
 * resolved, how many the file already had, and how many it left out of the comparison.
 */
export function validatorLines(reports: readonly ValidatorReport[] | undefined, what: string): string[] {
  return (reports ?? []).map((report) => {
    const line = `validator ${report.name}${report.detail ? ` (${report.detail})` : ''}: ${report.counts.errors} error(s), ${report.counts.warnings} warning(s) in the ${what}`;
    if (what !== 'result') return line;
    const left = (report.leftOut ?? []).map((group) => leftOutText(report.name, group));
    if (report.blocks !== false) return left.length ? `${line} (${left.join(', ')})` : line;
    return `${line} (${[`${report.errors.length + report.warnings.length} added`, `${report.resolved.length} resolved`, `${keptOf(report)} already in the file`, ...left].join(', ')})`;
  });
}

/**
 * Only for new ids under a declared prefix that differ from what the file's own style gives.
 */
export function conventionsLines(conventions: ConventionsReport | undefined): string[] {
  if (!conventions?.ids.length) return [];
  const ids = conventions.ids.length > FLOOD_IDS ? `${conventions.ids.slice(0, FLOOD_IDS).join(', ')}, +${conventions.ids.length - FLOOD_IDS} more` : conventions.ids.join(', ');
  return [`conventions: ${ids} follow${conventions.ids.length === 1 ? 's' : ''} element-id-naming (${conventions.source ?? 'the host'}), not the file's own id style  (\`bpmn show <file> --conventions\`)`];
}

/** `aliases: $check = Activity_CheckInvoice, $ok = Gateway_InvoiceOk` */
export function aliasLine(aliases: Record<string, string>): string {
  return `aliases: ${Object.entries(aliases).map(([alias, id]) => `${alias} = ${id}`).join(', ')}`;
}

export function fileLines(result: { file?: string; written?: boolean; unchanged: boolean }, opts: { dryRun?: boolean }): string[] {
  if (result.written) return [`written: ${result.file}${result.unchanged ? ' (unchanged copy of the input)' : ''}`];
  if (result.file && result.unchanged && !opts.dryRun) return [`unchanged: ${result.file} (the result equals the file; nothing written)`];
  if (result.file) return [`dry run: ${result.file} not written${result.unchanged ? ' (unchanged)' : ''}`];
  return [];
}
