import type { DrawnPlane } from '../../model/index.js';
import { ProblemReport } from '../plane/ProblemReport.js';
import { ScoringCriterion } from '../plane/ScoringCriterion.js';

export class LabelClashCriterion extends ScoringCriterion {
  readonly kinds = ['labelClash'] as const;

  run(plane: DrawnPlane, report: ProblemReport): void {
    plane.labels.forEach((label, index) => {
      for (const shape of plane.leaves.filter(({ id, bounds }) => id !== label.owner && label.box.overlaps(bounds))) {
        report.add('labelClash', `${label.owner}#L~${shape.id}`, [label.owner, shape.id], 'label on shape');
      }
      for (const other of plane.labels.slice(index + 1).filter(({ box }) => label.box.overlaps(box))) {
        report.add('labelClash', `${label.owner}#L~${other.owner}#L`, [label.owner, other.owner], ProblemReport.LABEL_ON_LABEL);
      }
    });
  }
}
