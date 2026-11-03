import type { BpmnElement } from '../document/BpmnElement.js';
import type { Box } from '../geometry/Box.js';
import type { Point } from '../geometry/Point.js';
import { Polyline } from '../geometry/Polyline.js';
import type { Segment } from '../geometry/Segment.js';

export type EdgeDrawing = Pick<DrawnEdge, 'id' | 'el' | 'points'> & Partial<Pick<DrawnEdge, 'label'>>;

export class DrawnEdge {
  readonly segments: readonly Segment[];
  readonly sourceId: string | undefined;
  readonly targetId: string | undefined;
  readonly ends: ReadonlySet<string | undefined>;
  readonly isSequenceFlow: boolean;
  readonly isMessageFlow: boolean;
  readonly isAnnotationLine: boolean;

  constructor(readonly id: string, readonly el: BpmnElement, readonly points: readonly Point[], readonly label: Box | undefined) {
    this.segments = new Polyline(points).segments();
    const source = el.peek<BpmnElement>('sourceRef');
    const target = el.peek<BpmnElement>('targetRef');
    this.sourceId = source?.id;
    this.targetId = target?.id;
    this.isSequenceFlow = el.is('bpmn:SequenceFlow');
    this.isMessageFlow = el.is('bpmn:MessageFlow');
    this.isAnnotationLine = el.is('bpmn:Association') && (!!source?.is('bpmn:TextAnnotation') || !!target?.is('bpmn:TextAnnotation'));
    const owner = el.parent?.is('bpmn:FlowNode') ? [el.parent.id] : [];
    this.ends = new Set([this.sourceId, this.targetId, ...el.list('sourceRef').map((sourceElement) => sourceElement.id), ...owner]);
  }

  static collinearLength({ start: firstStart, end: firstEnd }: Segment, { start: secondStart, end: secondEnd }: Segment): number {
    if (firstStart.x === firstEnd.x && secondStart.x === secondEnd.x && firstStart.x === secondStart.x) {
      return Math.min(Math.max(firstStart.y, firstEnd.y), Math.max(secondStart.y, secondEnd.y)) - Math.max(Math.min(firstStart.y, firstEnd.y), Math.min(secondStart.y, secondEnd.y));
    }
    if (firstStart.y === firstEnd.y && secondStart.y === secondEnd.y && firstStart.y === secondStart.y) {
      return Math.min(Math.max(firstStart.x, firstEnd.x), Math.max(secondStart.x, secondEnd.x)) - Math.max(Math.min(firstStart.x, firstEnd.x), Math.min(secondStart.x, secondEnd.x));
    }
    return 0;
  }

  get drawnEnds(): [string | undefined, string | undefined] {
    if (this.el.is('bpmn:DataInputAssociation')) {
      return [this.el.list('sourceRef')[0]?.id, this.el.parent?.id];
    }
    if (this.el.is('bpmn:DataOutputAssociation')) {
      return [this.el.parent?.id, this.targetId];
    }
    return [this.sourceId, this.targetId];
  }

  crosses(other: DrawnEdge): boolean {
    return this.segments.some((segment) => other.segments.some((theirs) => segment.crosses(theirs)));
  }

  sharesEndWith(other: DrawnEdge): boolean {
    return [...this.ends].some((end) => other.ends.has(end));
  }

  runsAlong(other: DrawnEdge): boolean {
    return this.segments.some((segment) => other.segments.some((theirs) => DrawnEdge.collinearLength(segment, theirs) > 0));
  }

  sharedLength(other: DrawnEdge, skippedPairs?: ReadonlySet<string>): number {
    let length = 0;
    for (const [index, segment] of this.segments.entries()) {
      for (const [otherIndex, theirs] of other.segments.entries()) {
        if (!skippedPairs?.has(`${index},${otherIndex}`)) {
          length += Math.max(0, DrawnEdge.collinearLength(segment, theirs));
        }
      }
    }
    return length;
  }
}
