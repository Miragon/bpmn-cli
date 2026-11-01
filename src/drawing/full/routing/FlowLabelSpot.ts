import { TextMetrics } from '@miragon/bpmn-render/text';
import { Box, type Point } from '../../../model/index.js';
import type { GEdge } from '../scopes/GEdge.js';

export class FlowLabelSpot {
  constructor(private readonly edge: GEdge) {}

  private static longestHorizontal(points: readonly Point[]): [Point, Point] {
    let spot: [Point, Point] = [points[0]!, points[1]!];
    let longest = -1;
    for (let index = 0; index + 1 < points.length; index++) {
      const [start, end] = [points[index]!, points[index + 1]!];
      const length = Math.abs(end.x - start.x);
      if (start.y === end.y && length > longest) {
        longest = length;
        spot = [start, end];
      }
    }
    return spot;
  }

  box(): Box | undefined {
    const { edge } = this;
    const { name, points } = edge;
    if (!name || points.length < 2) {
      return undefined;
    }
    const { width, height } = TextMetrics.labelSize(name);
    return this.isSelfLoop() ? this.belowSelfLoop(width, height) : this.onLongestRun(width, height);
  }

  private isSelfLoop(): boolean {
    const { back, source, target, points } = this.edge;
    return back && (source.host ?? source) === target && points.length === 4;
  }

  private belowSelfLoop(width: number, height: number): Box {
    const [start, end] = [this.edge.points[1]!, this.edge.points[2]!];
    return new Box(Math.round((start.x + end.x) / 2 - width / 2), start.y + 4, width, height);
  }

  private onLongestRun(width: number, height: number): Box {
    const [start, end] = FlowLabelSpot.longestHorizontal(this.edge.points);
    if (start.y !== end.y) {
      return new Box(start.x + 6, Math.min(start.y, end.y) + 6, width, height);
    }
    const low = Math.min(start.x, end.x);
    const high = Math.max(start.x, end.x);
    const labelX = this.edge.back ? Math.max(low + 2, high - width - 8) : Math.min(low + 8, Math.max(low + 2, high - width - 4));
    return new Box(Math.round(labelX), start.y - height - 4, width, height);
  }
}
