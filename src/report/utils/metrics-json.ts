import type { LayoutMetrics } from '../../diagram/metrics.js';

export function metricsJson(m: LayoutMetrics): Pick<LayoutMetrics, 'score' | 'counts' | 'problems'> {
  return { score: m.score, counts: m.counts, problems: m.problems };
}
