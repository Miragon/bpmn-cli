import { DrawnPlane } from '../plane/DrawnPlane.js';
import type { DrawnShape } from '../plane/DrawnShape.js';
import { ElementHomes } from '../plane/ElementHomes.js';
import type { ProblemReport } from '../plane/ProblemReport.js';
import { ScoringCriterion } from '../plane/ScoringCriterion.js';

export class FrameOverlapCriterion extends ScoringCriterion {
  readonly kinds = ['frameOverlap'] as const;

  private static familyOf(frame: DrawnShape, homes: ElementHomes): string | undefined {
    if (frame.isPool) {
      return 'pools';
    }
    const process = frame.isLane ? homes.processOf(frame.el) : ElementHomes.scopesOf(frame.el).find((scope) => scope.is('bpmn:Process'));
    return process ? `${frame.isLane ? 'lanes' : 'subs'}:${process.id ?? ''}` : undefined;
  }

  private static areNested(first: DrawnShape, second: DrawnShape): boolean {
    if (first.isLane) {
      return ElementHomes.laneChainOf(first.el).includes(second.el) || ElementHomes.laneChainOf(second.el).includes(first.el);
    }
    return ElementHomes.scopesOf(first.el).includes(second.el) || ElementHomes.scopesOf(second.el).includes(first.el);
  }

  private static overlapDeeply({ bounds: first }: DrawnShape, { bounds: second }: DrawnShape): boolean {
    return Math.min(first.right, second.right) - Math.max(first.x, second.x) > 1 && Math.min(first.bottom, second.bottom) - Math.max(first.y, second.y) > 1;
  }

  run(plane: DrawnPlane, report: ProblemReport): void {
    for (const [first, second] of DrawnPlane.pairs(plane.frames)) {
      const family = FrameOverlapCriterion.familyOf(first, plane.homes);
      if (family && family === FrameOverlapCriterion.familyOf(second, plane.homes) && !FrameOverlapCriterion.areNested(first, second) && FrameOverlapCriterion.overlapDeeply(first, second)) {
        report.add('frameOverlap', `${first.id}&${second.id}`, [first.id, second.id]);
      }
    }
  }
}
