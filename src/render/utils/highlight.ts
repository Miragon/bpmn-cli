import type { MutationReport } from '../../report/command-report.js';
import type { RenderHighlight } from '../types.js';

/** What a mutation touched, as halos; each id in its first category only. */
export function changeHighlight(report: Pick<MutationReport, 'created' | 'changed' | 'layout'>): Required<RenderHighlight> {
  const created = unique(report.created.map((created) => created.id));
  const format = report.layout.format ?? [];
  const changed = unique([...report.changed.map((changed) => changed.id), ...format.flatMap((formatted) => formatted.colored ?? [])]).filter((id) => !created.includes(id));
  const layout = report.layout;
  const moved = unique([...(layout.placed ?? []), ...(layout.moved ?? []), ...(layout.rerouted ?? []), ...(layout.reshaped ?? []), ...format.flatMap((formatted) => [...formatted.moved, ...formatted.rerouted, ...(formatted.reshaped ?? []), ...(formatted.labels ?? [])])]).filter(
    (id) => !created.includes(id) && !changed.includes(id),
  );
  return { created, changed, moved };
}

const unique = (ids: string[]): string[] => ids.filter((id, index) => ids.indexOf(id) === index);
