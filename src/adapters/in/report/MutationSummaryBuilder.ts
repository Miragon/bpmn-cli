import type { Change } from '../../../domain/document/ChangeSet.js';
import type { MutationReportLike, MutationSummary } from './command-report.js';
import { keptOf } from './utils/mutation-lines.js';

/** The summary of a mutation report (`--summary`). */
export class MutationSummaryBuilder {
  constructor(private readonly report: MutationReportLike) {}

  summary(): MutationSummary {
    const report = this.report;
    const created: Record<string, string[]> = {};
    for (const createdChange of report.created) {
      const ids = (created[createdChange.kind] ??= []);
      if (!ids.includes(createdChange.id)) ids.push(createdChange.id);
    }
    const metrics = report.layout.metrics;
    const left = (report.validation.validators ?? []).flatMap((validatorReport) => (validatorReport.leftOut ?? []).map((group) => ({ validator: validatorReport.name, ...group })));
    return {
      ok: true,
      ...(report.file !== undefined ? { file: report.file } : {}),
      ...(report.written !== undefined ? { written: report.written } : {}),
      unchanged: report.unchanged,
      created,
      ...(report.aliases && Object.keys(report.aliases).length ? { aliases: report.aliases } : {}),
      // an element the change created is listed once, as created; the full report has the rest
      changed: MutationSummaryBuilder.uniqueIds(report.changed).filter((id) => !report.created.some((created) => created.id === id)),
      ...(report.renamed ? { renamed: report.renamed } : {}),
      removed: MutationSummaryBuilder.uniqueIds(report.removed),
      ...(report.validation.errors.length ? { forced: report.validation.errors } : {}),
      // the summary prints no validator line: an advisory validator's old findings are counted here
      warnings: { added: report.warnings.added, resolvedCount: report.warnings.resolved.length, preexistingCount: report.warnings.preexistingCount + (report.validation.validators ?? []).filter((validatorReport) => validatorReport.blocks === false).reduce((sum, kept) => sum + keptOf(kept), 0) },
      // the findings a validator did not compare (bpmnlint in CI reports them)
      ...(left.length ? { leftOut: left } : {}),
      layout: {
        status: report.layout.status,
        ...(report.layout.mode ? { mode: report.layout.mode } : {}),
        ...(metrics ? { score: { ...(metrics.before ? { before: metrics.before.score } : {}), after: metrics.after.score } } : {}),
        ...(metrics?.before && metrics.added.length ? { added: metrics.added } : {}),
        ...(metrics && !metrics.before && metrics.added.length ? { problems: metrics.added.length } : {}),
      },
      ...(report.layout.format?.length ? { format: report.layout.format } : {}),
      ...(report.conventions ? { conventions: report.conventions } : {}),
    };
  }

  private static uniqueIds(changes: readonly Change[]): string[] {
    return [...new Set(changes.map((change) => change.id).filter(Boolean))];
  }
}
