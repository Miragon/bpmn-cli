import type { DrawnEdge } from '../plane/DrawnEdge.js';
import type { DrawnPlane } from '../plane/DrawnPlane.js';
import type { ProblemReport } from '../plane/ProblemReport.js';
import { ScoringCriterion } from '../plane/ScoringCriterion.js';

export class MessageThroughPoolCriterion extends ScoringCriterion {
  readonly kinds = ['msgThroughPool'] as const;

  private static endsAndPools({ sourceId, targetId }: DrawnEdge, { homes }: DrawnPlane): Set<string | undefined> {
    const ends = [sourceId, targetId];
    return new Set([...ends, ...ends.map((id) => homes.pools.get(homes.processOf(homes.parents.get(id))?.id)?.id)]);
  }

  run(plane: DrawnPlane, report: ProblemReport): void {
    for (const edge of plane.edges.filter(({ isMessageFlow }) => isMessageFlow)) {
      const allowed = MessageThroughPoolCriterion.endsAndPools(edge, plane);
      for (const pool of plane.pools.filter(({ id }) => !allowed.has(id))) {
        if (edge.segments.some((segment) => segment.hitsBounds(pool.bounds, 2))) {
          report.add('msgThroughPool', `${edge.id}->${pool.id}`, [edge.id, pool.id]);
        }
      }
    }
  }
}
