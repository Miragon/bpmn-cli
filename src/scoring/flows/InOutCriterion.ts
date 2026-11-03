import type { DrawnPlane } from '../../model/index.js';
import type { ProblemReport } from '../plane/ProblemReport.js';
import { ScoringCriterion } from '../plane/ScoringCriterion.js';

export class InOutCriterion extends ScoringCriterion {
  readonly kinds = ['inOut'] as const;

  run(plane: DrawnPlane, report: ProblemReport): void {
    for (const shape of plane.shapes) {
      const outgoing = plane.sequenceFlows.filter(({ sourceId }) => sourceId === shape.id);
      for (const incoming of plane.sequenceFlows.filter(({ targetId }) => targetId === shape.id)) {
        for (const out of outgoing.filter((flow) => flow !== incoming && incoming.runsAlong(flow))) {
          report.add('inOut', `${incoming.id}|${out.id}@${shape.id}`, [incoming.id, out.id, shape.id]);
        }
      }
    }
  }
}
