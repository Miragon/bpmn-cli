import { Segment, type Point } from '../../model/index.js';
import { DrawnEdge } from '../plane/DrawnEdge.js';
import type { DrawnShape } from '../plane/DrawnShape.js';

interface Run {
  segment: Segment;
  indexes: number[];
}

export class JoinTail {
  private static readonly TOLERANCE = 2;

  constructor(private readonly target: DrawnShape | undefined) {}

  private static direction({ start, end }: Segment): string {
    return `${Math.sign(end.x - start.x)},${Math.sign(end.y - start.y)}`;
  }

  private static runsOf(segments: readonly Segment[]): Run[] {
    const runs: Run[] = [];
    const leading: number[] = [];
    segments.forEach((segment, index) => {
      const last = runs.at(-1);
      const { start, end } = segment;
      const isEmpty = start.x === end.x && start.y === end.y;
      const isStraight = start.x === end.x || start.y === end.y;
      if (!last && isEmpty) {
        leading.push(index);
      } else if (last && (isEmpty || (isStraight && JoinTail.direction(last.segment) === JoinTail.direction(segment)))) {
        last.segment = new Segment(last.segment.start, end);
        last.indexes.push(index);
      } else {
        runs.push({ segment, indexes: runs.length ? [index] : [...leading, index] });
      }
    });
    if (!runs.length && leading.length) {
      runs.push({ segment: segments[leading[0]!]!, indexes: leading });
    }
    return runs;
  }

  private static isNear(here: Point, there: Point): boolean {
    return Math.abs(here.x - there.x) <= JoinTail.TOLERANCE && Math.abs(here.y - there.y) <= JoinTail.TOLERANCE;
  }

  segmentPairs(first: DrawnEdge, second: DrawnEdge): ReadonlySet<string> {
    const tail = new Set<string>();
    if (!this.target?.el.is('bpmn:Gateway')) {
      return tail;
    }
    const firstRuns = JoinTail.runsOf(first.segments);
    const secondRuns = JoinTail.runsOf(second.segments);
    const side = this.entrySide(firstRuns.at(-1));
    if (!side || this.entrySide(secondRuns.at(-1)) !== side) {
      return tail;
    }
    for (let firstIndex = firstRuns.length - 1, secondIndex = secondRuns.length - 1; firstIndex >= 0 && secondIndex >= 0; firstIndex--, secondIndex--) {
      const firstRun = firstRuns[firstIndex]!;
      const secondRun = secondRuns[secondIndex]!;
      if (DrawnEdge.collinearLength(firstRun.segment, secondRun.segment) <= 0) {
        break;
      }
      firstRun.indexes.forEach((one) => secondRun.indexes.forEach((other) => tail.add(`${one},${other}`)));
      if (!JoinTail.isNear(firstRun.segment.start, secondRun.segment.start)) {
        break;
      }
      if (firstIndex === 0 && secondIndex === 0) {
        return new Set();
      }
    }
    return tail;
  }

  private entrySide(run: Run | undefined): number {
    const { bounds } = this.target!;
    if (!run || run.segment.start.x !== run.segment.end.x || Math.abs(run.segment.end.x - bounds.center.x) > JoinTail.TOLERANCE) {
      return 0;
    }
    const { start, end } = run.segment;
    if (Math.abs(end.y - bounds.bottom) <= JoinTail.TOLERANCE && start.y > end.y) {
      return 1;
    }
    return Math.abs(end.y - bounds.y) <= JoinTail.TOLERANCE && start.y < end.y ? -1 : 0;
  }
}
