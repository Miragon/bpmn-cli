import { DrawnPlane } from '../plane/DrawnPlane.js';
import type { ProblemReport } from '../plane/ProblemReport.js';
import { ScoringCriterion } from '../plane/ScoringCriterion.js';

export class OverlapCriterion extends ScoringCriterion {
  readonly kinds = ['overlaps'] as const;

  run(plane: DrawnPlane, report: ProblemReport): void {
    for (const [first, second] of DrawnPlane.pairs(plane.leaves)) {
      if (!first.isAttachedTo(second) && !second.isAttachedTo(first) && first.bounds.overlaps(second.bounds)) {
        report.add('overlaps', `${first.id}~${second.id}`, [first.id, second.id]);
      }
    }
  }
}
