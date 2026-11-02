import type { DrawnPlane } from '../plane/DrawnPlane.js';
import type { ProblemReport } from '../plane/ProblemReport.js';
import { ScoringCriterion } from '../plane/ScoringCriterion.js';

export class LabelOnLineCriterion extends ScoringCriterion {
  readonly kinds = ['labelOnLine'] as const;

  run(plane: DrawnPlane, report: ProblemReport): void {
    for (const { owner, text } of plane.labels) {
      for (const edge of plane.edges.filter(({ segments }) => segments.some((segment) => segment.hitsBounds(text)))) {
        report.add('labelOnLine', `${owner}#L~${edge.id}`, [owner, edge.id]);
      }
    }
  }
}
