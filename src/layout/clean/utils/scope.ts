import type { Box, GArtifact, GNode, LinkEnd, ScopeLayout } from '../../../drawing/types.js';
import { toSegments, type Segment } from './geometry.js';

/** data objects and notes of boundary events are placed before routing */
export function routedArtifacts(layout: ScopeLayout): GArtifact[] {
  return layout.artifacts.filter((a) => a.kind !== 'annotation' || !!a.anchorNode?.host);
}

export function obstacles(layout: ScopeLayout): Box[] {
  const boxes: Box[] = [];
  for (const n of layout.nodes) {
    boxes.push(n.box);
    for (const b of n.boundary) boxes.push(b.box);
  }
  for (const a of routedArtifacts(layout)) boxes.push(a.box);
  return boxes;
}

export function routedSegments(layout: ScopeLayout): Segment[] {
  return layout.edges.flatMap((e) => toSegments(e.points));
}

export function growToFit(layout: ScopeLayout): void {
  for (const a of layout.artifacts) {
    for (const link of a.links) {
      for (const p of link.points) {
        layout.width = Math.max(layout.width, p.x);
        layout.height = Math.max(layout.height, p.y);
      }
    }
  }
  for (const c of layout.compensations) {
    for (const p of c.points) {
      layout.width = Math.max(layout.width, p.x);
      layout.height = Math.max(layout.height, p.y);
    }
  }
}

export function shiftScope(layout: ScopeLayout, dx: number, dy: number): void {
  for (const n of layout.nodes) shiftNode(n, dx, dy);
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
  for (const a of layout.artifacts) {
    a.box.x += dx;
    a.box.y += dy;
    for (const link of a.links) {
      moveEnd(link.from);
      moveEnd(link.to);
      for (const p of link.points) {
        p.x += dx;
        p.y += dy;
      }
    }
    moveEnd(a.anchor);
  }
  shiftEdges(layout, dx, dy);
  layout.width += dx;
  layout.height += dy;
}

export function shiftEdges(layout: ScopeLayout, dx: number, dy: number): void {
  for (const e of layout.edges) {
    for (const p of e.points) {
      p.x += dx;
      p.y += dy;
    }
    if (e.label) {
      e.label.x += dx;
      e.label.y += dy;
    }
    if (e.bandY !== undefined) e.bandY += dy;
  }
  for (const c of layout.compensations) {
    for (const p of c.points) {
      p.x += dx;
      p.y += dy;
    }
  }
}

export function shiftNode(n: GNode, dx: number, dy: number): void {
  n.box.x += dx;
  n.box.y += dy;
  for (const b of n.boundary) {
    b.box.x += dx;
    b.box.y += dy;
  }
}
