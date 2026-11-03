import type { DrawnEdge, DrawnPlane, DrawnShape } from '../../model/index.js';
import type { ProblemReport } from '../plane/ProblemReport.js';
import { ScoringCriterion } from '../plane/ScoringCriterion.js';

export class ThroughCriterion extends ScoringCriterion {
  readonly kinds = ['through'] as const;

  private static connects(edge: DrawnEdge, shape: DrawnShape): boolean {
    return edge.ends.has(shape.id) || (shape.isBoundary && edge.ends.has(shape.hostId));
  }

  run(plane: DrawnPlane, report: ProblemReport): void {
    for (const edge of plane.edges) {
      for (const segment of edge.segments) {
        for (const shape of plane.leaves.filter((leaf) => !ThroughCriterion.connects(edge, leaf) && segment.hits(leaf.bounds))) {
          report.add('through', `${edge.id}->${shape.id}`, [edge.id, shape.id]);
        }
      }
    }
  }
}
