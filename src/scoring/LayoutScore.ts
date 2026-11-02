import { ProblemKinds } from './plane/ProblemKinds.js';
import type { LayoutProblem } from './plane/ProblemReport.js';
import { ScoreChange, type ScoredProblems } from './ScoreChange.js';

export class LayoutScore implements ScoredProblems {
  readonly counts = ProblemKinds.perKind(() => 0);
  readonly score: number;

  constructor(readonly problems: readonly LayoutProblem[]) {
    for (const { kind } of problems) {
      this.counts[kind]++;
    }
    this.score = ProblemKinds.ALL.reduce((sum, kind) => sum + this.counts[kind] * ProblemKinds.recordOf(kind).weight, 0);
  }

  to(after: LayoutScore): ScoreChange {
    return new ScoreChange(this, after);
  }
}
