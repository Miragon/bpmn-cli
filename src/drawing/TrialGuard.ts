import { diffProblems, type LayoutMetrics, type LayoutProblem } from './utils/problems.js';

export interface TrialPolicy {
  /** undefined: not guarded; a trial must not raise any guarded count */
  key(p: LayoutProblem): string | undefined;
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
    const m = this.measure();
    const left = new Map(this.counts);
    const added = m.problems.filter((p) => {
      const key = this.policy.key(p);
      if (key === undefined) return false;
      const n = left.get(key) ?? 0;
      left.set(key, n - 1);
      return n <= 0;
    });
    const now = this.countsOf(m);
    const addedKeys = [...now].filter(([k, c]) => c > (this.counts.get(k) ?? 0)).map(([k]) => k);
    const before = this.base.score;
    const ok = !added.length && (this.policy.lower ? m.score < before : m.score <= before);
    if (!ok) this.rejected.push(...(added.length ? added : diffProblems(this.base.problems, m.problems).added));
    else {
      this.base = m;
      if (this.policy.rebase) this.counts = now;
    }
    return { ok, before, after: m.score, added, addedKeys };
  }

  private countsOf(m: LayoutMetrics): Map<string, number> {
    const out = new Map<string, number>();
    for (const p of m.problems) {
      const key = this.policy.key(p);
      if (key !== undefined) out.set(key, (out.get(key) ?? 0) + 1);
    }
    return out;
  }
}
