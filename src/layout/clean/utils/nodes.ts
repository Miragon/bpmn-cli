import type { GEdge, GNode } from '../../../diagram/types.js';

/** Outgoing flows of a node including those of its boundary events (they leave from the host's column). */
export function outgoingOf(n: GNode): GEdge[] {
  return [...n.out, ...n.boundary.flatMap((b) => b.out)];
}

/** A node of the layout that is an event (is(n.el, 'bpmn:Event'), told by its kind: ScopeGraph, a boundary event's 'event'). */
export function isEvent(n: GNode): boolean {
  return n.kind === 'start' || n.kind === 'end' || n.kind === 'event';
}

/** true when the boundary events of a host sit on the left part of its bottom border (collapsed sub-processes) */
export function boundaryLeft(n: GNode): boolean {
  return n.kind === 'subProcess' && !n.child;
}
