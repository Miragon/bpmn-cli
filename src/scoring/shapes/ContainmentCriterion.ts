import type { DrawnPlane } from '../plane/DrawnPlane.js';
import { DrawnShape } from '../plane/DrawnShape.js';
import type { ProblemReport } from '../plane/ProblemReport.js';
import { ScoringCriterion } from '../plane/ScoringCriterion.js';

export class ContainmentCriterion extends ScoringCriterion {
  readonly kinds = ['outsideSub', 'outsideLane', 'outsidePool'] as const;

  run(plane: DrawnPlane, report: ProblemReport): void {
    for (const shape of plane.shapes.filter(({ isPool, isLane }) => !isPool && !isLane)) {
      const parent = plane.homes.parents.get(shape.id);
      const subProcess = plane.expandedSubProcess(parent);
      if (subProcess && !DrawnShape.isWithin(shape.bounds, subProcess.bounds)) {
        report.add('outsideSub', shape.id, [shape.id, subProcess.id]);
      }
      const lane = plane.shape(plane.homes.lanes.get(shape.id)?.id);
      if (lane && !shape.isBoundary && !DrawnShape.isWithin(shape.bounds, lane.bounds)) {
        report.add('outsideLane', shape.id, [shape.id, lane.id]);
      }
      const pool = parent?.is('bpmn:Process') ? plane.poolOf(parent) : undefined;
      if (pool && !DrawnShape.isWithin(shape.bounds, pool.bounds)) {
        report.add('outsidePool', shape.id, [shape.id, pool.id]);
      }
    }
  }
}
