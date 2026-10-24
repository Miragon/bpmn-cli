import { KEYS, type LayoutMetrics } from '../diagram/utils/problems.js';
import { problemText } from './utils/result-lines.js';
import { INDENT } from './utils/view-lines.js';

/** `bpmn metrics`: the score line, then one line per problem. */
export class MetricsText {
  constructor(private readonly metrics: LayoutMetrics) {}

  text(): string {
    return [this.scoreLine(), ...this.problemLines()].join('\n') + '\n';
  }

  /** `score 12: crossings 1, labelOnLine 7` (non-zero counts in metric order). */
  scoreLine(): string {
    const m = this.metrics;
    const counts = KEYS.filter((k) => m.counts[k] > 0).map((k) => `${k} ${m.counts[k]}`);
    return `score ${m.score}${counts.length ? `: ${counts.join(', ')}` : ': no layout problems'}`;
  }

  problemLines(): string[] {
    return this.metrics.problems.map((p) => `${INDENT}${problemText(p)}`);
  }
}
