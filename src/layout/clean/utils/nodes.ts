import type { GEdge, GNode } from '../../../drawing/types.js';

export function outgoingOf(n: GNode): GEdge[] {
  return [...n.out, ...n.boundary.flatMap((b) => b.out)];
}

export function isEvent(n: GNode): boolean {
  return n.kind === 'start' || n.kind === 'end' || n.kind === 'event';
}

/** collapsed sub-processes keep their boundary events left, away from the drill-down marker */
export function boundaryLeft(n: GNode): boolean {
  return n.kind === 'subProcess' && !n.child;
}
