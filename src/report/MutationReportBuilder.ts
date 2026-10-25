import type { MutationResult } from '../pipeline/index.js';
import type { Warning } from '../shared/CliError.js';
import type { MutationReport } from './command-report.js';
import { layoutWarnings } from './utils/findings.js';

export class MutationReportBuilder {
  constructor(private readonly result: MutationResult) {}

  /** Without those the validator reports too: the validator's has the richer hint. */
  opWarnings(): Warning[] {
    const validationKeys = new Set(this.result.validation.warnings.map(MutationReportBuilder.findingKey));
    return this.result.changes.warnings.filter((w) => !validationKeys.has(MutationReportBuilder.findingKey(w)));
  }

  /** What --strict counts. */
  warnings(): Warning[] {
    return [...this.opWarnings(), ...this.result.validation.warnings, ...layoutWarnings(this.result.layout)];
  }

  report(): MutationReport {
    const result = this.result;
    // a result built without the pipeline's delta reports every validation warning as added
    const delta = result.delta ?? { added: result.validation.warnings, resolved: [], preexisting: 0 };
    const { warnings: _all, ...validation } = result.validation;
    const renamed = this.renamedIds();
    return {
      ok: true,
      file: result.file,
      written: result.written,
      unchanged: result.unchanged,
      created: result.changes.created,
      changed: result.changes.changed,
      removed: result.changes.removed,
      warnings: { added: [...this.opWarnings(), ...delta.added, ...layoutWarnings(result.layout)], resolved: delta.resolved, preexistingCount: delta.preexisting },
      notes: result.changes.notes,
      ...(result.aliases ? { aliases: result.aliases } : {}),
      ...(renamed ? { renamed } : {}),
      layout: result.layout,
      validation,
      importWarnings: result.importWarnings,
      ...(result.view ? { view: result.view } : {}),
      ...(result.conventions ? { conventions: result.conventions } : {}),
    };
  }

  /**
   * A chain A -> B -> C reads A -> C. A takeover (the id of an element the change removed)
   * is no rename: the old id is listed as removed, the taken one as changed.
   */
  private renamedIds(): Record<string, string> | undefined {
    const result = this.result;
    const out = new Map<string, string>();
    for (const { from, to, takeover } of result.changes.renames ?? []) {
      if (takeover) {
        for (const [old, now] of out) if (now === from) out.delete(old);
        continue;
      }
      let chained = false;
      for (const [old, now] of out) {
        if (now !== from) continue;
        out.set(old, to);
        chained = true;
      }
      if (!chained) out.set(from, to);
    }
    // only ids the file had before count
    const created = new Set(result.changes.created.map((c) => c.id));
    for (const [old, now] of out) if (old === now || created.has(now)) out.delete(old);
    return out.size ? Object.fromEntries(out) : undefined;
  }

  private static findingKey(w: Warning): string {
    // an event-gateway finding is about one branch: another target is another finding
    return `${w.code}|${w.element ?? ''}${w.code === 'W_EVENT_GATEWAY_TARGET' ? `|${w.related?.[0] ?? ''}` : ''}`;
  }
}
