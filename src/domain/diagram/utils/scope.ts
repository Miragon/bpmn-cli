import type { Box, GArtifact, GNode, LinkEnd, ScopeLayout } from '../di/types.js';
import { toSegments, translate, translateEdge, translatePoints, type Segment } from './geom.js';

/** data objects and notes of boundary events are placed before routing */
export function routedArtifacts(layout: ScopeLayout): GArtifact[] {
  return layout.artifacts.filter((artifact) => artifact.kind !== 'annotation' || !!artifact.anchorNode?.host);
}

export function obstacles(layout: ScopeLayout): Box[] {
  const boxes: Box[] = [];
  for (const node of layout.nodes) {
    boxes.push(node.box);
    for (const boundaryEvent of node.boundary) boxes.push(boundaryEvent.box);
  }
  for (const artifact of routedArtifacts(layout)) boxes.push(artifact.box);
  return boxes;
}

export function routedSegments(layout: ScopeLayout): Segment[] {
  return layout.edges.flatMap((edge) => toSegments(edge.points));
}

export function growToFit(layout: ScopeLayout): void {
  for (const artifact of layout.artifacts) {
    for (const link of artifact.links) {
      for (const point of link.points) {
        layout.width = Math.max(layout.width, point.x);
        layout.height = Math.max(layout.height, point.y);
      }
    }
  }
  for (const compensation of layout.compensations) {
    for (const point of compensation.points) {
      layout.width = Math.max(layout.width, point.x);
      layout.height = Math.max(layout.height, point.y);
    }
  }
}

/** Shifts the whole scope; a flow anchor is the same object as the link end using it and moves once. */
export function shiftScope(layout: ScopeLayout, dx: number, dy: number): void {
  for (const node of layout.nodes) shiftNode(node, dx, dy);
  for (const es of layout.eventSubs) translate(es.box, dx, dy);
  const movedEnds = new Set<LinkEnd>();
  const moveEnd = (end: LinkEnd | undefined): void => {
    if (!end?.flow || movedEnds.has(end)) return;
    movedEnds.add(end);
    translate(end.box, dx, dy);
  };
  for (const artifact of layout.artifacts) {
    translate(artifact.box, dx, dy);
    for (const link of artifact.links) {
      moveEnd(link.from);
      moveEnd(link.to);
      translatePoints(link.points, dx, dy);
    }
    moveEnd(artifact.anchor);
  }
  shiftEdges(layout, dx, dy);
  layout.width += dx;
  layout.height += dy;
}

function shiftEdges(layout: ScopeLayout, dx: number, dy: number): void {
  for (const edge of layout.edges) {
    translateEdge(edge, dx, dy);
    if (edge.bandY !== undefined) edge.bandY += dy;
  }
  for (const compensation of layout.compensations) translatePoints(compensation.points, dx, dy);
}

export function shiftNode(node: GNode, dx: number, dy: number): void {
  translate(node.box, dx, dy);
  for (const boundaryEvent of node.boundary) translate(boundaryEvent.box, dx, dy);
}
