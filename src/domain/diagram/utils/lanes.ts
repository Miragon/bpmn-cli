import type { LaneBox } from '../di/types.js';

export function laneDepth(lanes: LaneBox[]): number {
  return lanes.length ? 1 + Math.max(...lanes.map((child) => laneDepth(child.children))) : 0;
}

export function stretchLane(lane: LaneBox, width: number): void {
  lane.box.width = width - lane.box.x;
  for (const child of lane.children) stretchLane(child, width);
}
