import { diffProblems, type LayoutMetrics, type LayoutProblem } from './utils/problems.js';

/** What a trial must not make worse. */
export interface TrialPolicy {
  /** the key a guarded problem is counted by (undefined: not guarded); a trial must not raise any count */
  key(p: LayoutProblem): string | undefined;
  /** a trial must lower the score (else: not raise it) */
  lower: boolean;
  /** the guarded counts follow every trial kept (else: they stay those of the start) */
  rebase: boolean;
}

export interface Verdict {
  ok: boolean;
  /** the score before and after the trial */
  before: number;
  after: number;
  /** the guarded problems beyond the counts, in the order they were found */
  added: LayoutProblem[];
  /** their keys, in the order the keys first occur in the drawing */
  addedKeys: string[];
}

/**
 * Judges trials, changes of a drawing that are kept only when they make it
 * no worse: it measures the drawing (`measure`, the planes written first),
 * compares the guarded problem counts and the score with its baseline
 * (TrialPolicy) and takes a kept trial's measurement as the new baseline.
 * `rejected` collects what the rejected trials would have added: the
 * guarded problems beyond the counts, else (the score) every problem the
 * trial added.
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
