import type { Box, GArtifact, GNode, LinkEnd, ScopeLayout } from '../../../drawing/types.js';
import { toSegments, type Segment } from './geometry.js';

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

export function shiftScope(layout: ScopeLayout, dx: number, dy: number): void {
  for (const node of layout.nodes) shiftNode(node, dx, dy);
  for (const es of layout.eventSubs) {
    es.box.x += dx;
    es.box.y += dy;
  }
  // an anchor on a flow is the same object as the link end that uses it: move it once
  const movedEnds = new Set<LinkEnd>();
  const moveEnd = (end: LinkEnd | undefined): void => {
    if (!end?.flow || movedEnds.has(end)) return;
    movedEnds.add(end);
    end.box.x += dx;
    end.box.y += dy;
  };
  for (const artifact of layout.artifacts) {
    artifact.box.x += dx;
    artifact.box.y += dy;
    for (const link of artifact.links) {
      moveEnd(link.from);
      moveEnd(link.to);
      for (const point of link.points) {
        point.x += dx;
        point.y += dy;
      }
    }
    moveEnd(artifact.anchor);
  }
  shiftEdges(layout, dx, dy);
  layout.width += dx;
  layout.height += dy;
}

export function shiftEdges(layout: ScopeLayout, dx: number, dy: number): void {
  for (const edge of layout.edges) {
    for (const point of edge.points) {
      point.x += dx;
      point.y += dy;
    }
    if (edge.label) {
      edge.label.x += dx;
      edge.label.y += dy;
    }
    if (edge.bandY !== undefined) edge.bandY += dy;
  }
  for (const compensation of layout.compensations) {
    for (const point of compensation.points) {
      point.x += dx;
      point.y += dy;
    }
  }
}

export function shiftNode(node: GNode, dx: number, dy: number): void {
  node.box.x += dx;
  node.box.y += dy;
  for (const boundaryEvent of node.boundary) {
    boundaryEvent.box.x += dx;
    boundaryEvent.box.y += dy;
  }
}
