import { Box, type BpmnDocument, DrawnEdge, DrawnPlane, ElementHomes, Point, type Segment } from '../model/index.js';
import { JoinTail } from './flows/JoinTail.js';
import { LabelTitleCriterion } from './labels/LabelTitleCriterion.js';
import { ProblemReport, type LayoutProblem } from './plane/ProblemReport.js';

export class ProblemLocator {
  private readonly planes: DrawnPlane[];

  constructor(document: BpmnDocument) {
    this.planes = DrawnPlane.of(DrawnPlane.read(document), new ElementHomes(document));
  }

  private static rounded(coordinate: number): number {
    return Math.round(coordinate * 100) / 100 || 0;
  }

  private static meetCentre(first: Box, second: Box): Point {
    const left = Math.max(first.x, second.x);
    const top = Math.max(first.y, second.y);
    const width = Math.min(first.right, second.right) - left;
    const height = Math.min(first.bottom, second.bottom) - top;
    return width >= 0 && height >= 0 ? new Point(left + width / 2, top + height / 2) : first.center;
  }

  private static crossPoint({ start, end }: Segment, { start: otherStart, end: otherEnd }: Segment): Point {
    const denominator = (end.x - start.x) * (otherEnd.y - otherStart.y) - (end.y - start.y) * (otherEnd.x - otherStart.x);
    const progress = denominator ? ((otherStart.x - start.x) * (otherEnd.y - otherStart.y) - (otherStart.y - start.y) * (otherEnd.x - otherStart.x)) / denominator : 0.5;
    return new Point(start.x + progress * (end.x - start.x), start.y + progress * (end.y - start.y));
  }

  private static crossingOf(first: DrawnEdge, second: DrawnEdge): Point | undefined {
    for (const segment of first.segments) {
      const crossed = second.segments.find((theirs) => segment.crosses(theirs));
      if (crossed) {
        return ProblemLocator.crossPoint(segment, crossed);
      }
    }
    return undefined;
  }

  private static span(delta: number, from: number, min: number, max: number): [number, number] {
    if (delta === 0) {
      return from < min || from > max ? [0, -1] : [0, 1];
    }
    const [first, second] = [(min - from) / delta, (max - from) / delta];
    return [Math.min(first, second), Math.max(first, second)];
  }

  private static clipMiddle(segment: Segment | undefined, box: Box, shrink: number): Point | undefined {
    if (!segment) {
      return undefined;
    }
    const { start, end } = segment;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const inner = box.grow(-shrink);
    const [lowX, highX] = ProblemLocator.span(dx, start.x, inner.x, inner.right);
    const [lowY, highY] = ProblemLocator.span(dy, start.y, inner.y, inner.bottom);
    const [low, high] = [Math.max(0, lowX, lowY), Math.min(1, highX, highY)];
    if (low <= high) {
      return new Point(start.x + ((low + high) / 2) * dx, start.y + ((low + high) / 2) * dy);
    }
    return ProblemLocator.meetCentre(new Box(Math.min(start.x, end.x), Math.min(start.y, end.y), Math.abs(dx), Math.abs(dy)), box);
  }

  private static sharedAt(first: DrawnEdge, second: DrawnEdge, skippedPairs?: ReadonlySet<string>): Point | undefined {
    for (const [index, segment] of first.segments.entries()) {
      for (const [otherIndex, theirs] of second.segments.entries()) {
        if (!skippedPairs?.has(`${index},${otherIndex}`) && DrawnEdge.collinearLength(segment, theirs) > 0) {
          return ProblemLocator.middleOfOverlap(segment, theirs);
        }
      }
    }
    return undefined;
  }

  private static middleOfOverlap({ start, end }: Segment, { start: otherStart, end: otherEnd }: Segment): Point {
    const middle = (axis: 'x' | 'y'): number => (Math.max(Math.min(start[axis], end[axis]), Math.min(otherStart[axis], otherEnd[axis])) + Math.min(Math.max(start[axis], end[axis]), Math.max(otherStart[axis], otherEnd[axis]))) / 2;
    return start.x === end.x ? new Point(start.x, middle('y')) : new Point(middle('x'), start.y);
  }

  private static halfway(edge: DrawnEdge): Point | undefined {
    const length = ({ start, end }: Segment): number => Math.hypot(end.x - start.x, end.y - start.y);
    let rest = edge.segments.reduce((sum, segment) => sum + length(segment), 0) / 2;
    for (const segment of edge.segments) {
      const { start, end } = segment;
      if (length(segment) >= rest && length(segment) > 0) {
        return new Point(start.x + ((end.x - start.x) * rest) / length(segment), start.y + ((end.y - start.y) * rest) / length(segment));
      }
      rest -= length(segment);
    }
    return edge.points[0];
  }

  private static onShape({ kind, ids, detail }: LayoutProblem, plane: DrawnPlane): Point | undefined {
    const first = plane.shape(ids[0]);
    const second = plane.shape(ids[1]);
    switch (kind) {
      case 'overlaps': case 'frameOverlap':
        return first && second && ProblemLocator.meetCentre(first.bounds, second.bounds);
      case 'frameIntrusion': case 'outsideLane': case 'outsidePool': case 'outsideSub':
        return first?.bounds.center;
      case 'laneGap':
        return first && second && new Point(first.bounds.center.x, detail === 'bottom' ? (first.bounds.bottom + second.bounds.bottom) / 2 : (first.bounds.y + second.bounds.y) / 2);
    }
  }

  private static onEdge({ kind, ids }: LayoutProblem, plane: DrawnPlane): Point | undefined {
    const edge = plane.edge(ids[0]);
    const other = plane.edge(ids[1]);
    const shape = plane.shape(ids[1]);
    if (!edge) {
      return undefined;
    }
    switch (kind) {
      case 'crossings':
        return other && ProblemLocator.crossingOf(edge, other);
      case 'through':
        return shape && ProblemLocator.clipMiddle(edge.segments.find((segment) => segment.hits(shape.bounds)), shape.bounds, 2);
      case 'msgThroughPool':
        return shape && ProblemLocator.clipMiddle(edge.segments.find((segment) => segment.hitsBounds(shape.bounds, 2)), shape.bounds, 2);
      case 'diagonal': {
        const diagonal = edge.segments.find(({ start, end }) => start.x !== end.x && start.y !== end.y);
        return diagonal && new Point((diagonal.start.x + diagonal.end.x) / 2, (diagonal.start.y + diagonal.end.y) / 2);
      }
      case 'degenerateEdge':
        return edge.points[0];
      case 'detachedEdge':
        return edge.points.length < 2 ? undefined : edge.points.at(edge.drawnEnds[0] === ids[1] ? 0 : -1);
      case 'inOut': case 'parallelRun':
        return other && ProblemLocator.sharedAt(edge, other);
      case 'segmentOverlap':
        return other && ProblemLocator.sharedAt(edge, other, new JoinTail(plane.shape(ids[2])).segmentPairs(edge, other));
      case 'edgeLeavesLane': case 'edgeOutside':
        return shape && edge.points.find((point) => !shape.bounds.contains(point));
      case 'backwardFlow':
        return ProblemLocator.halfway(edge);
    }
  }

  private static onLabel(problem: LayoutProblem, plane: DrawnPlane): Point | undefined {
    const [ownerId, otherId] = problem.ids;
    const own = plane.labels.find(({ owner }) => owner === ownerId);
    const shape = plane.shape(otherId);
    switch (problem.kind) {
      case 'labelClash': {
        const other = problem.detail === ProblemReport.LABEL_ON_LABEL ? plane.labels.find(({ owner }) => owner === otherId)?.box : shape?.bounds;
        return own && other && ProblemLocator.meetCentre(own.box, other);
      }
      case 'labelOnLine':
        return own && ProblemLocator.clipMiddle(plane.edge(otherId)?.segments.find((segment) => segment.hitsBounds(own.text)), own.text, 0);
      case 'labelOutsideFrame': case 'messageLabelFar':
        return own?.box.center;
      case 'labelOnTitle': {
        const title = shape && LabelTitleCriterion.titleOf(shape);
        return own && title && ProblemLocator.meetCentre(own.box, title);
      }
    }
  }

  locate(problems: readonly LayoutProblem[]): LayoutProblem[] {
    return problems.map((problem) => {
      const [first] = problem.ids;
      const plane = this.planes.find((candidate) => candidate.root && (candidate.shape(first) || candidate.edge(first)));
      const at = plane && (ProblemLocator.onShape(problem, plane) ?? ProblemLocator.onEdge(problem, plane) ?? ProblemLocator.onLabel(problem, plane));
      if (!at || !Number.isFinite(at.x) || !Number.isFinite(at.y)) {
        return { ...problem };
      }
      return { ...problem, at: { plane: plane!.root!, x: ProblemLocator.rounded(at.x), y: ProblemLocator.rounded(at.y) } };
    });
  }
}
