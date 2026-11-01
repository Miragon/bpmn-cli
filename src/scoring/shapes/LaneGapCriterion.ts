import type { BpmnElement } from '../../model/index.js';
import type { DrawnPlane } from '../plane/DrawnPlane.js';
import type { ProblemReport } from '../plane/ProblemReport.js';
import { ScoringCriterion } from '../plane/ScoringCriterion.js';

export class LaneGapCriterion extends ScoringCriterion {
  readonly kinds = ['laneGap'] as const;

  run(plane: DrawnPlane, report: ProblemReport): void {
    for (const pool of plane.pools) {
      for (const laneSet of pool.el.peek<BpmnElement>('processRef')?.list('laneSets') ?? []) {
        const lanes = laneSet.list('lanes');
        const first = plane.shape(lanes[0]?.id);
        const last = plane.shape(lanes.at(-1)?.id);
        if (first && Math.abs(first.bounds.y - pool.bounds.y) > 1) {
          report.add('laneGap', `${first.id}:top`, [first.id, pool.id], 'top');
        }
        if (last && Math.abs(last.bounds.bottom - pool.bounds.bottom) > 1) {
          report.add('laneGap', `${last.id}:bottom`, [last.id, pool.id], 'bottom');
        }
      }
    }
  }
}
