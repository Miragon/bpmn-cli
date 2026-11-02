import type { DrawnPlane } from '../plane/DrawnPlane.js';
import type { ProblemReport } from '../plane/ProblemReport.js';
import { ScoringCriterion } from '../plane/ScoringCriterion.js';

export class MissingCriterion extends ScoringCriterion {
  readonly kinds = ['missing'] as const;

  run(plane: DrawnPlane, report: ProblemReport): void {
    for (const id of plane.homes.required) {
      if (!plane.shows(id)) {
        report.add('missing', id, [id]);
      }
    }
  }
}
