import type { LayoutMetrics } from '../../drawing/utils/problems.js';

export function metricsJson(metrics: LayoutMetrics): Pick<LayoutMetrics, 'score' | 'counts' | 'problems'> {
  return { score: metrics.score, counts: metrics.counts, problems: metrics.problems };
}
