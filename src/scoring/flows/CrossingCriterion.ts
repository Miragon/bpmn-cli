import { DrawnPlane } from '../../model/index.js';
import type { ProblemReport } from '../plane/ProblemReport.js';
import { ScoringCriterion } from '../plane/ScoringCriterion.js';

export class CrossingCriterion extends ScoringCriterion {
  readonly kinds = ['crossings'] as const;

  run(plane: DrawnPlane, report: ProblemReport): void {
    for (const [first, second] of DrawnPlane.pairs(plane.edges)) {
      if (!first.isAnnotationLine && !second.isAnnotationLine && first.crosses(second)) {
        report.add('crossings', `${first.id}x${second.id}`, [first.id, second.id]);
      }
    }
  }
}
