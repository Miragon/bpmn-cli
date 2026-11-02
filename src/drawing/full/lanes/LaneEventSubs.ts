import { Box } from '../../../model/index.js';
import { ShapeSizes } from '../../plane/ShapeSizes.js';
import type { ScopeLayout } from '../scopes/GNode.js';
import { LaneStrips } from './LaneStrips.js';
import type { LaneBand } from './LaneTree.js';

export class LaneEventSubs {
  private readonly strips: LaneStrips;

  constructor(
    private readonly scope: ScopeLayout,
    private readonly leaves: readonly LaneBand[],
  ) {
    this.strips = new LaneStrips(scope, leaves);
  }

  place(): number {
    const { scope, leaves } = this;
    const last = leaves.at(-1)!;
    const inner = leaves.filter((lane) => lane !== last && lane.subs.length);
    for (const lane of inner) {
      this.stackIn(lane);
    }
    const placed = new Set(inner.flatMap((lane) => lane.subs));
    let lowest = last.y + last.height - ShapeSizes.LANE_PADDING;
    for (const eventSub of scope.eventSubs.filter((sub) => !placed.has(sub))) {
      eventSub.box.y = lowest + ShapeSizes.GAPS.vGap;
      lowest = eventSub.box.bottom;
    }
    return lowest;
  }

  private contentBottom(lane: LaneBand): number {
    const { artifacts, edges } = this.scope;
    const top = lane.y;
    const bottom = lane.y + lane.height;
    const isInBand = (y: number): boolean => y > top && y <= bottom;
    const labelStartsIn = (y: number): boolean => y >= top && y < bottom;
    const reaches = [bottom - ShapeSizes.LANE_PADDING];
    for (const node of lane.nodes) {
      reaches.push(node.box.bottom, ...node.boundary.map((event) => event.box.bottom));
    }
    reaches.push(...artifacts.filter((artifact) => isInBand(artifact.box.center.y)).map((artifact) => artifact.box.bottom));
    for (const edge of edges) {
      reaches.push(...edge.points.filter((point) => isInBand(point.y)).map((point) => point.y));
      if (edge.label && labelStartsIn(edge.label.y)) {
        reaches.push(edge.label.bottom);
      }
    }
    return Math.max(...reaches);
  }

  private stackIn(lane: LaneBand): void {
    const { scope } = this;
    const { vGap } = ShapeSizes.GAPS;
    const bottom = lane.y + lane.height;
    let stackBottom = this.contentBottom(lane);
    const stack = lane.subs.map((eventSub) => {
      const at = stackBottom + vGap;
      stackBottom = at + eventSub.height;
      return { eventSub, at };
    });
    const dy = Math.max(0, Math.round(stackBottom + ShapeSizes.LANE_PADDING - bottom));
    const left = this.strips.freeX(bottom, Math.max(...lane.subs.map((eventSub) => eventSub.width)));
    if (dy) {
      this.strips.open(bottom, dy);
    }
    lane.height += dy;
    for (const { eventSub, at } of stack) {
      eventSub.box = new Box(left, Math.round(at), eventSub.width, eventSub.height);
      scope.width = Math.max(scope.width, left + eventSub.width);
    }
  }
}
