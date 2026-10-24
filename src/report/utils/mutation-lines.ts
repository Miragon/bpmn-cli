import type { ConventionsReport } from '../../pipeline/index.js';
import type { ValidatorReport } from '../../validate/validators.js';
import { FLOOD_IDS } from './findings.js';

/** The findings a validator left out of the comparison of a result (ValidatorReport.leftOut). */
function leftOutCount(r: ValidatorReport): number {
  return (r.leftOut ?? []).reduce((n, g) => n + g.count, 0);
}

/**
 * `7 left out (incoming / outgoing lists the file does not keep; `bpmn
 * validate <file>` lists them)`: the project's bpmnlint runs in `bpmn
 * validate`, a host's validator in the host's check.
 */
export function leftOutText(validator: string, g: { reason: string; count: number }): string {
  const it = g.count === 1 ? 'it' : 'them';
  // 'bpmnlint': BPMNLINT_VALIDATOR, as validatorRefusal names it (the report does not import src/validate/BpmnlintValidator.ts)
  return `${g.count} left out (${g.reason}; ${validator === 'bpmnlint' ? `\`bpmn validate <file>\` lists ${it}` : `a check lists ${it}`})`;
}

/** The findings of an advisory validator's report of a result that the change did not add and the validator did not leave out: the file already had them. */
export function keptOf(r: ValidatorReport): number {
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
export function validatorLines(reports: readonly ValidatorReport[] | undefined, what: string): string[] {
  return (reports ?? []).map((r) => {
    const line = `validator ${r.name}${r.detail ? ` (${r.detail})` : ''}: ${r.counts.errors} error(s), ${r.counts.warnings} warning(s) in the ${what}`;
    if (what !== 'result') return line;
    const left = (r.leftOut ?? []).map((g) => leftOutText(r.name, g));
    if (r.blocks !== false) return left.length ? `${line} (${left.join(', ')})` : line;
    return `${line} (${[`${r.errors.length + r.warnings.length} added`, `${r.resolved.length} resolved`, `${keptOf(r)} already in the file`, ...left].join(', ')})`;
  });
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
export function aliasLine(aliases: Record<string, string>): string {
  return `aliases: ${Object.entries(aliases).map(([a, id]) => `${a} = ${id}`).join(', ')}`;
}

/** The file line of a result: written / unchanged / dry run. */
export function fileLines(result: { file?: string; written?: boolean; unchanged: boolean }, opts: { dryRun?: boolean }): string[] {
  if (result.written) return [`written: ${result.file}${result.unchanged ? ' (unchanged copy of the input)' : ''}`];
  if (result.file && result.unchanged && !opts.dryRun) return [`unchanged: ${result.file} (the result equals the file; nothing written)`];
  if (result.file) return [`dry run: ${result.file} not written${result.unchanged ? ' (unchanged)' : ''}`];
  return [];
}
