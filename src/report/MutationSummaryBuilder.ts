import type { Change } from '../model/ChangeSet.js';
import type { MutationReportLike, MutationSummary } from './command-report.js';
import { keptOf } from './utils/mutation-lines.js';

/** The summary of a mutation report (`--summary`; also of applyToXml's `result`). */
export class MutationSummaryBuilder {
  constructor(private readonly report: MutationReportLike) {}

  summary(): MutationSummary {
    const report = this.report;
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
      changed: MutationSummaryBuilder.uniqueIds(report.changed).filter((id) => !report.created.some((c) => c.id === id)),
      ...(report.renamed ? { renamed: report.renamed } : {}),
      removed: MutationSummaryBuilder.uniqueIds(report.removed),
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

  /** The ids of the entries, once each (an entry without id, a removed flow that had none, names nothing to use). */
  private static uniqueIds(changes: readonly Change[]): string[] {
    return [...new Set(changes.map((c) => c.id).filter(Boolean))];
  }
}
