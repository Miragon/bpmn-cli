import type { DrawnPlane } from '../../model/index.js';
import type { ProblemReport } from '../plane/ProblemReport.js';
import { ScoringCriterion } from '../plane/ScoringCriterion.js';

export class DiagonalCriterion extends ScoringCriterion {
  readonly kinds = ['diagonal'] as const;

  run(plane: DrawnPlane, report: ProblemReport): void {
    for (const edge of plane.edges.filter(({ isSequenceFlow, isMessageFlow }) => isSequenceFlow || isMessageFlow)) {
      if (edge.segments.some(({ start, end }) => start.x !== end.x && start.y !== end.y)) {
        report.add('diagonal', edge.id, [edge.id]);
      }
    }
  }
}
