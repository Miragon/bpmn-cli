import { ProblemKinds, ProblemReport, Scorer, type ElementHomes, type LayoutProblem, type LayoutScore } from '../../scoring/index.js';
import { Plane } from './Plane.js';

export interface TrialPolicy {
  key(problem: LayoutProblem): string | undefined;
  lower: boolean;
  rebase: boolean;
}

export interface Verdict {
  ok: boolean;
  before: number;
  after: number;
  added: LayoutProblem[];
  addedKeys: string[];
}

export class TrialGuard {
  static readonly NO_WORSE: TrialPolicy = { key: (problem) => (ProblemKinds.isHard(problem.kind) ? ProblemReport.identityOf(problem) : undefined), lower: false, rebase: false };

  readonly rejected: LayoutProblem[] = [];
  private base: LayoutScore;
  private counts: Map<string, number>;

  constructor(
    private readonly planes: readonly Plane[],
    private readonly homes: ElementHomes,
    private readonly policy: TrialPolicy = TrialGuard.NO_WORSE,
    private readonly scorer = new Scorer(),
  ) {
    this.base = this.measure();
    this.counts = this.countsOf(this.base);
  }

  get score(): number {
    return this.base.score;
  }

  judge(): Verdict {
    const measured = this.measure();
    const added = this.addedTo(measured);
    const now = this.countsOf(measured);
    const addedKeys = [...now].filter(([key, count]) => count > (this.counts.get(key) ?? 0)).map(([key]) => key);
    const before = this.base.score;
    const ok = !added.length && (this.policy.lower ? measured.score < before : measured.score <= before);
    if (ok) {
      this.base = measured;
      if (this.policy.rebase) {
        this.counts = now;
      }
    } else {
      this.rejected.push(...(added.length ? added : this.base.to(measured).added));
    }
    return { ok, before, after: measured.score, added, addedKeys };
  }

  private measure(): LayoutScore {
    return this.scorer.scoreDrawing(Plane.drawingsOf(this.planes), this.homes);
  }

  private addedTo(measured: LayoutScore): LayoutProblem[] {
    const left = new Map(this.counts);
    return measured.problems.filter((problem) => {
      const key = this.policy.key(problem);
      if (key === undefined) {
        return false;
      }
      const count = left.get(key) ?? 0;
      left.set(key, count - 1);
      return count <= 0;
    });
  }

  private countsOf(score: LayoutScore): Map<string, number> {
    const counts = new Map<string, number>();
    for (const problem of score.problems) {
      const key = this.policy.key(problem);
      if (key !== undefined) {
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    return counts;
  }
}
