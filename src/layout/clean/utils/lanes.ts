import type { LaneBox } from '../../../diagram/types.js';

export function laneDepth(lanes: LaneBox[]): number {
  return lanes.length ? 1 + Math.max(...lanes.map((l) => laneDepth(l.children))) : 0;
}

export function stretchLane(lane: LaneBox, width: number): void {
  lane.box.width = width - lane.box.x;
  for (const c of lane.children) stretchLane(c, width);
}
