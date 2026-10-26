import type { GEdge, GNode } from '../di/types.js';

export function outgoingOf(node: GNode): GEdge[] {
  return [...node.out, ...node.boundary.flatMap((boundaryEvent) => boundaryEvent.out)];
}

export function isEvent(node: GNode): boolean {
  return node.kind === 'start' || node.kind === 'end' || node.kind === 'event';
}

/** collapsed sub-processes keep their boundary events left, away from the drill-down marker */
export function boundaryLeft(node: GNode): boolean {
  return node.kind === 'subProcess' && !node.child;
}
