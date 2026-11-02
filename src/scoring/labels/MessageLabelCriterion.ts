import { Point, type Box, type Segment } from '../../model/index.js';
import type { DrawnPlane } from '../plane/DrawnPlane.js';
import type { ProblemReport } from '../plane/ProblemReport.js';
import { ScoringCriterion } from '../plane/ScoringCriterion.js';

export class MessageLabelCriterion extends ScoringCriterion {
  readonly kinds = ['messageLabelFar'] as const;

  private static readonly FARTHEST = 50;

  private static distanceToBox(point: Point, box: Box): number {
    return Math.hypot(Math.max(box.x - point.x, 0, point.x - box.right), Math.max(box.y - point.y, 0, point.y - box.bottom));
  }

  private static distanceToSegment(point: Point, { start, end }: Segment): number {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const squaredLength = dx * dx + dy * dy;
    const progress = squaredLength ? Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / squaredLength)) : 0;
    return Math.hypot(point.x - (start.x + progress * dx), point.y - (start.y + progress * dy));
  }

  private static distance(segment: Segment, box: Box): number {
    const { start, end } = segment;
    if (box.contains(start) || box.contains(end) || segment.hits(box, 0)) {
      return 0;
    }
    const corners = [new Point(box.x, box.y), new Point(box.right, box.y), new Point(box.x, box.bottom), new Point(box.right, box.bottom)];
    return Math.min(MessageLabelCriterion.distanceToBox(start, box), MessageLabelCriterion.distanceToBox(end, box), ...corners.map((corner) => MessageLabelCriterion.distanceToSegment(corner, segment)));
  }

  run(plane: DrawnPlane, report: ProblemReport): void {
    for (const edge of plane.edges) {
      const { label, segments, id } = edge;
      if (edge.isMessageFlow && label && segments.length && edge.el.peek<string>('name')?.trim()) {
        const distance = Math.min(...segments.map((segment) => MessageLabelCriterion.distance(segment, label)));
        if (distance > MessageLabelCriterion.FARTHEST) {
          report.add('messageLabelFar', id, [id], `${Math.round(distance)}px`);
        }
      }
    }
  }
}
