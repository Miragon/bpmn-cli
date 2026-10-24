import type { LayoutMetrics } from '../../diagram/metrics.js';

/** `bpmn metrics --json` and metricsXml: the layout score, the count per kind and every problem with its element ids. */
export function metricsJson(m: LayoutMetrics): Pick<LayoutMetrics, 'score' | 'counts' | 'problems'> {
  return { score: m.score, counts: m.counts, problems: m.problems };
}
