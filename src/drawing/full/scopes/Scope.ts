import { Polyline, type Box, type Segment } from '../../../model/index.js';
import type { GArtifact, LinkEnd, ScopeLayout } from './GNode.js';

export class Scope {
  constructor(private readonly layout: ScopeLayout) {}

  routedArtifacts(): GArtifact[] {
    return this.layout.artifacts.filter((artifact) => artifact.kind !== 'annotation' || !!artifact.anchorNode?.host);
  }

  obstacles(artifacts = this.routedArtifacts()): Box[] {
    const boxes: Box[] = [];
    for (const node of this.layout.nodes) {
      boxes.push(node.box);
      for (const boundaryEvent of node.boundary) {
        boxes.push(boundaryEvent.box);
      }
    }
    for (const artifact of artifacts) {
      boxes.push(artifact.box);
    }
    return boxes;
  }

  routedSegments(): Segment[] {
    return this.layout.edges.flatMap((edge) => new Polyline(edge.points).segments());
  }

  growToFit(): void {
    const { layout } = this;
    const lines = [...layout.artifacts.flatMap((artifact) => artifact.links), ...layout.compensations];
    for (const point of lines.flatMap((line) => line.points)) {
      layout.width = Math.max(layout.width, point.x);
      layout.height = Math.max(layout.height, point.y);
    }
  }

  shift(dx: number, dy: number): void {
    const { layout } = this;
    for (const node of layout.nodes) {
      node.shift(dx, dy);
    }
    for (const eventSub of layout.eventSubs) {
      eventSub.box.translate(dx, dy);
    }
    this.shiftArtifacts(dx, dy);
    this.shiftEdges(dx, dy);
    layout.width += dx;
    layout.height += dy;
  }

  private shiftArtifacts(dx: number, dy: number): void {
    const movedEnds = new Set<LinkEnd>();
    const moveEnd = (end: LinkEnd | undefined): void => {
      if (end?.flow && !movedEnds.has(end)) {
        movedEnds.add(end);
        end.box.translate(dx, dy);
      }
    };
    for (const artifact of this.layout.artifacts) {
      artifact.box.translate(dx, dy);
      for (const link of artifact.links) {
        moveEnd(link.from);
        moveEnd(link.to);
        new Polyline(link.points).translate(dx, dy);
      }
      moveEnd(artifact.anchor);
    }
  }

  private shiftEdges(dx: number, dy: number): void {
    for (const edge of this.layout.edges) {
      new Polyline(edge.points).translate(dx, dy);
      edge.label?.translate(dx, dy);
      if (edge.bandY !== undefined) {
        edge.bandY += dy;
      }
    }
    for (const compensation of this.layout.compensations) {
      new Polyline(compensation.points).translate(dx, dy);
    }
  }
}
