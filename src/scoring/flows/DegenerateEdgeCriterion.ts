import type { DrawnPlane } from '../../model/index.js';
import type { ProblemReport } from '../plane/ProblemReport.js';
import { ScoringCriterion } from '../plane/ScoringCriterion.js';

export class DegenerateEdgeCriterion extends ScoringCriterion {
  readonly kinds = ['degenerateEdge'] as const;

  run(plane: DrawnPlane, report: ProblemReport): void {
    for (const edge of plane.edges) {
      const length = edge.segments.reduce((sum, { start, end }) => sum + Math.abs(end.x - start.x) + Math.abs(end.y - start.y), 0);
      if (edge.points.length < 2 || !(length > 0)) {
        report.add('degenerateEdge', edge.id, [edge.id]);
      }
    }
  }
}
