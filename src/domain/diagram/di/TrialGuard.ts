import { diffProblems, type LayoutMetrics, type LayoutProblem } from '../utils/problems.js';

export interface TrialPolicy {
  /** undefined: not guarded; a trial must not raise any guarded count */
  key(problem: LayoutProblem): string | undefined;
  /** else a trial only must not raise it */
  lower: boolean;
  /** else the guarded counts stay those of the start */
  rebase: boolean;
}

export interface Verdict {
  ok: boolean;
  before: number;
  after: number;
  added: LayoutProblem[];
  /** in the order the keys first occur in the drawing */
  addedKeys: string[];
}

/**
 * Judges trials, drawing changes kept only when they make it no worse by the guarded counts and
 * the score. `rejected` collects what the rejected trials would have added.
 */
export class TrialGuard {
  readonly rejected: LayoutProblem[] = [];
  private base: LayoutMetrics;
  private counts: Map<string, number>;

  constructor(
    private readonly measure: () => LayoutMetrics,
    private readonly policy: TrialPolicy,
  ) {
    this.base = measure();
    this.counts = this.countsOf(this.base);
  }

  get score(): number {
    return this.base.score;
  }

  judge(): Verdict {
    const metrics = this.measure();
    const left = new Map(this.counts);
    const added = metrics.problems.filter((problem) => {
      const key = this.policy.key(problem);
      if (key === undefined) return false;
      const count = left.get(key) ?? 0;
      left.set(key, count - 1);
      return count <= 0;
    });
    const now = this.countsOf(metrics);
    const addedKeys = [...now].filter(([key, count]) => count > (this.counts.get(key) ?? 0)).map(([key]) => key);
    const before = this.base.score;
    const ok = !added.length && (this.policy.lower ? metrics.score < before : metrics.score <= before);
    if (!ok) this.rejected.push(...(added.length ? added : diffProblems(this.base.problems, metrics.problems).added));
    else {
      this.base = metrics;
      if (this.policy.rebase) this.counts = now;
    }
    return { ok, before, after: metrics.score, added, addedKeys };
  }

  private countsOf(metrics: LayoutMetrics): Map<string, number> {
    const out = new Map<string, number>();
    for (const problem of metrics.problems) {
      const key = this.policy.key(problem);
      if (key !== undefined) out.set(key, (out.get(key) ?? 0) + 1);
    }
    return out;
  }
}
