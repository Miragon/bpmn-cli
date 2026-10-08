/**
 * Layout score of the PR #218 tool (Miragon/design-iq, `@bpmiq/bpmn-edit`),
 * used only when env BPMN_EDIT_MAIN points at its CLI entry (<checkout>/src/main.ts).
 *
 * Contract: `loadPrMetrics()` -> undefined without BPMN_EDIT_MAIN, else
 * { score(xml) -> { score, sums, planes } }: the tool's own per-plane score()
 * (src/layout/score.ts, summed over the planes its reader finds) and the sums
 * of its measurePlane() metrics (src/metrics/metrics.ts). Nothing is copied
 * from the PR; its TypeScript sources are imported directly (Node >= 23 strips
 * the types). score() throws when the tool cannot read the file; the caller
 * records that as an error.
 */
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const load = (file) => import(pathToFileURL(file).href);

export async function loadPrMetrics(env = process.env) {
  if (!env.BPMN_EDIT_MAIN) return undefined;
  const src = dirname(env.BPMN_EDIT_MAIN);
  const [{ readPlanes }, { score }, { measurePlane }] = await Promise.all([
    load(join(src, 'diagram', 'reader.ts')),
    load(join(src, 'layout', 'score.ts')),
    load(join(src, 'metrics', 'metrics.ts')),
  ]);
  return {
    async score(xml) {
      const planes = await readPlanes(xml, 'bench.bpmn');
      const metrics = planes.map((p) => measurePlane(p));
      const scores = planes.map((p) => +score(p).toFixed(2));
      const sums = {};
      for (const m of metrics) for (const [k, v] of Object.entries(m)) if (typeof v === 'number') sums[k] = (sums[k] ?? 0) + v;
      return { score: +scores.reduce((a, b) => a + b, 0).toFixed(2), sums, planes: planes.length };
    },
  };
}
