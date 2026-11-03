import { DrawnPlane } from '../../model/index.js';
import type { ProblemReport } from '../plane/ProblemReport.js';
import { ScoringCriterion } from '../plane/ScoringCriterion.js';

export class ParallelRunCriterion extends ScoringCriterion {
  readonly kinds = ['parallelRun'] as const;

  private static readonly SHORTEST_RUN = 20;

  run(plane: DrawnPlane, report: ProblemReport): void {
    for (const [first, second] of DrawnPlane.pairs(plane.edges)) {
      const length = first.sharesEndWith(second) ? 0 : first.sharedLength(second);
      if (length > ParallelRunCriterion.SHORTEST_RUN) {
        report.add('parallelRun', `${first.id}=${second.id}(${length})`, [first.id, second.id], `${length}px`);
      }
    }
  }
}
