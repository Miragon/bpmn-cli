import type { LayoutMetrics } from '../../drawing/utils/problems.js';

export function metricsJson(m: LayoutMetrics): Pick<LayoutMetrics, 'score' | 'counts' | 'problems'> {
  return { score: m.score, counts: m.counts, problems: m.problems };
}
