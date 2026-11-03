import { type DrawnPlane, DrawnShape } from '../../model/index.js';
import type { ProblemReport } from '../plane/ProblemReport.js';
import { ScoringCriterion } from '../plane/ScoringCriterion.js';

export class LabelOutsideFrameCriterion extends ScoringCriterion {
  readonly kinds = ['labelOutsideFrame'] as const;

  private static readonly SLACK = 2;

  private static frameOf(id: string, plane: DrawnPlane): DrawnShape | undefined {
    const parent = plane.homes.parents.get(id);
    return parent && (plane.expandedSubProcess(parent) ?? plane.poolOf(plane.homes.processOf(parent)));
  }

  run(plane: DrawnPlane, report: ProblemReport): void {
    for (const owner of plane.namedOuterLabels().filter(({ el }) => !el.is('bpmn:MessageFlow'))) {
      const frame = LabelOutsideFrameCriterion.frameOf(owner.id, plane);
      if (frame && !DrawnShape.isWithin(owner.label!, frame.bounds.grow(LabelOutsideFrameCriterion.SLACK))) {
        report.add('labelOutsideFrame', `${owner.id}#L@${frame.id}`, [owner.id, frame.id]);
      }
    }
  }
}
