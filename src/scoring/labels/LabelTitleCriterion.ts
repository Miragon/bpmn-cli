import { TextMetrics } from '@miragon/bpmn-render/text';
import { Box } from '../../model/index.js';
import type { DrawnPlane } from '../plane/DrawnPlane.js';
import type { DrawnShape } from '../plane/DrawnShape.js';
import type { ProblemReport } from '../plane/ProblemReport.js';
import { ScoringCriterion } from '../plane/ScoringCriterion.js';

export class LabelTitleCriterion extends ScoringCriterion {
  readonly kinds = ['labelOnTitle'] as const;

  static titleOf({ expanded, el, bounds }: DrawnShape): Box | undefined {
    const title = expanded && el.is('bpmn:SubProcess') ? TextMetrics.titleBox(bounds, el.peek<string>('name')) : undefined;
    return title && new Box(title.x, title.y, title.width, title.height);
  }

  run(plane: DrawnPlane, report: ProblemReport): void {
    const titles = plane.shapes.map((shape) => ({ id: shape.id, box: LabelTitleCriterion.titleOf(shape) })).filter(({ box }) => box);
    for (const owner of titles.length ? plane.namedOuterLabels() : []) {
      for (const title of titles.filter(({ box }) => owner.label!.overlaps(box!))) {
        report.add('labelOnTitle', `${owner.id}#L^${title.id}`, [owner.id, title.id]);
      }
    }
  }
}
