import { ProblemReport, type LayoutProblem } from './plane/ProblemReport.js';
import type { ProblemKind } from './plane/ProblemKinds.js';

export interface ScoreSummary {
  counts: Record<ProblemKind, number>;
  score: number;
}

export interface ScoredProblems extends ScoreSummary {
  problems: readonly LayoutProblem[];
}

export class ScoreChange {
  readonly before: ScoreSummary | undefined;
  readonly after: ScoreSummary;
  readonly added: LayoutProblem[];
  readonly resolved: LayoutProblem[];

  constructor(before: ScoredProblems | undefined, after: ScoredProblems) {
    this.before = before && { counts: before.counts, score: before.score };
    this.after = { counts: after.counts, score: after.score };
    this.added = ScoreChange.unmatched(after.problems, before?.problems ?? []);
    this.resolved = ScoreChange.unmatched(before?.problems ?? [], after.problems);
  }

  private static unmatched(problems: readonly LayoutProblem[], others: readonly LayoutProblem[]): LayoutProblem[] {
    const left = new Map<string, number>();
    for (const other of others) {
      const identity = ProblemReport.identityOf(other);
      left.set(identity, (left.get(identity) ?? 0) + 1);
    }
    return problems.filter((problem) => {
      const identity = ProblemReport.identityOf(problem);
      const count = left.get(identity) ?? 0;
      left.set(identity, count - 1);
      return count <= 0;
    });
  }
}
