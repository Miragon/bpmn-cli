import { KEYS, type LayoutMetrics } from '../../../domain/diagram/utils/problems.js';
import { problemText } from './utils/result-lines.js';
import { INDENT } from './utils/view-lines.js';

/** `bpmn metrics`: the score line, then one line per problem. */
export class MetricsText {
  constructor(private readonly metrics: LayoutMetrics) {}

  text(): string {
    return [this.scoreLine(), ...this.problemLines()].join('\n') + '\n';
  }

  /** `score 12: crossings 1, labelOnLine 7` */
  scoreLine(): string {
    const metrics = this.metrics;
    const counts = KEYS.filter((key) => metrics.counts[key] > 0).map((key) => `${key} ${metrics.counts[key]}`);
    return `score ${metrics.score}${counts.length ? `: ${counts.join(', ')}` : ': no layout problems'}`;
  }

  problemLines(): string[] {
    return this.metrics.problems.map((problem) => `${INDENT}${problemText(problem)}`);
  }
}
