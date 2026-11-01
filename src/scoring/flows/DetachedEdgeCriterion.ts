import type { Box, Point } from '../../model/index.js';
import type { DrawnPlane } from '../plane/DrawnPlane.js';
import type { ProblemReport } from '../plane/ProblemReport.js';
import { ScoringCriterion } from '../plane/ScoringCriterion.js';

export class DetachedEdgeCriterion extends ScoringCriterion {
  readonly kinds = ['detachedEdge'] as const;

  private static readonly GAP = 10;

  private static isFarFrom({ x, y }: Point, box: Box): boolean {
    const { GAP } = DetachedEdgeCriterion;
    return x < box.x - GAP || x > box.right + GAP || y < box.y - GAP || y > box.bottom + GAP;
  }

  run(plane: DrawnPlane, report: ProblemReport): void {
    for (const edge of plane.edges.filter(({ points }) => points.length >= 2)) {
      const [sourceId, targetId] = edge.drawnEnds;
      const ends = [
        { shape: plane.shape(sourceId), point: edge.points[0]! },
        { shape: plane.shape(targetId), point: edge.points.at(-1)! },
      ];
      const missed = ends.flatMap(({ shape, point }) => (shape && DetachedEdgeCriterion.isFarFrom(point, shape.bounds) ? [shape.id] : []));
      if (missed.length) {
        report.add('detachedEdge', edge.id, [edge.id, ...missed]);
      }
    }
  }
}
