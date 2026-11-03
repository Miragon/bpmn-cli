import type { DrawnPlane } from '../../model/index.js';
import type { ProblemReport } from '../plane/ProblemReport.js';
import { ScoringCriterion } from '../plane/ScoringCriterion.js';

export class BackwardFlowCriterion extends ScoringCriterion {
  readonly kinds = ['backwardFlow'] as const;

  run(plane: DrawnPlane, report: ProblemReport): void {
    for (const flow of plane.sequenceFlows) {
      const source = plane.shape(flow.sourceId);
      const target = plane.shape(flow.targetId);
      if (source && target && !(target.bounds.center.x >= source.bounds.x) && !plane.homes.reaches(target.id, source.id)) {
        report.add('backwardFlow', flow.id, [flow.id, source.id, target.id]);
      }
    }
  }
}
