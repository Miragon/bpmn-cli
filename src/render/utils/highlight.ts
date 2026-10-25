import type { MutationReport } from '../../report/command-report.js';
import type { RenderHighlight } from '../types.js';

/** What a mutation touched, as halos; each id in its first category only. */
export function changeHighlight(report: Pick<MutationReport, 'created' | 'changed' | 'layout'>): Required<RenderHighlight> {
  const created = unique(report.created.map((c) => c.id));
  const format = report.layout.format ?? [];
  const changed = unique([...report.changed.map((c) => c.id), ...format.flatMap((f) => f.colored ?? [])]).filter((id) => !created.includes(id));
  const l = report.layout;
  const moved = unique([...(l.placed ?? []), ...(l.moved ?? []), ...(l.rerouted ?? []), ...(l.reshaped ?? []), ...format.flatMap((f) => [...f.moved, ...f.rerouted, ...(f.reshaped ?? []), ...(f.labels ?? [])])]).filter(
    (id) => !created.includes(id) && !changed.includes(id),
  );
  return { created, changed, moved };
}

const unique = (ids: string[]): string[] => ids.filter((id, i) => ids.indexOf(id) === i);
