import { type DrawnEdge, DrawnPlane } from '../../model/index.js';
import type { ProblemReport } from '../plane/ProblemReport.js';
import { ScoringCriterion } from '../plane/ScoringCriterion.js';
import { JoinTail } from './JoinTail.js';

export class SegmentOverlapCriterion extends ScoringCriterion {
  readonly kinds = ['segmentOverlap'] as const;

  private static readonly SHORTEST_OVERLAP = 20;

  private static flowsByTarget(plane: DrawnPlane): Map<string, DrawnEdge[]> {
    const byTarget = new Map<string, DrawnEdge[]>();
    for (const flow of plane.sequenceFlows.filter(({ targetId }) => targetId)) {
      byTarget.set(flow.targetId!, [...(byTarget.get(flow.targetId!) ?? []), flow]);
    }
    return byTarget;
  }

  run(plane: DrawnPlane, report: ProblemReport): void {
    for (const [target, flows] of SegmentOverlapCriterion.flowsByTarget(plane)) {
      const joinTail = new JoinTail(plane.shape(target));
      for (const [first, second] of DrawnPlane.pairs(flows)) {
        const length = first.sharedLength(second, joinTail.segmentPairs(first, second));
        if (length > SegmentOverlapCriterion.SHORTEST_OVERLAP) {
          report.add('segmentOverlap', `${first.id}=${second.id}`, [first.id, second.id, target], `${length}px`);
        }
      }
    }
  }
}
