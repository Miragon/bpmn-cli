import { Polyline, type Box, type BpmnElement, type Point, type Segment } from '../../../model/index.js';
import type { GArtifact, LinkEnd } from './GArtifact.js';
import type { GEdge } from './GEdge.js';
import type { GNode } from './GNode.js';
import type { LaneBox } from './LaneBox.js';

export interface LaneBandInfo {
  nodes: Set<GNode>;
  top: number;
  bottom: number;
}

export interface Compensation {
  el: BpmnElement;
  id: string;
  event: GNode;
  handler: GNode;
  points: Point[];
}

export interface CrossLink {
  el: BpmnElement;
  id: string;
  sourceId: string;
  targetId: string;
}

export class ScopeLayout {
  readonly artifacts: GArtifact[] = [];
  readonly compensations: Compensation[] = [];
  width = 0;
  height = 0;
  lanes: LaneBox[] = [];
  laneBands?: LaneBandInfo[] | undefined;
  readonly crossLinks: CrossLink[] = [];

  constructor(
    readonly el: BpmnElement,
    readonly nodes: GNode[],
    readonly edges: GEdge[],
    readonly eventSubs: GNode[],
  ) {}

  routedArtifacts(): GArtifact[] {
    return this.artifacts.filter((artifact) => artifact.isRoutedAround);
  }

  obstacles(artifacts = this.routedArtifacts()): Box[] {
    const boxes: Box[] = [];
    for (const node of this.nodes) {
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
    return this.edges.flatMap((edge) => new Polyline(edge.points).segments());
  }

  growToFit(): void {
    const lines = [...this.artifacts.flatMap((artifact) => artifact.links), ...this.compensations];
    for (const point of lines.flatMap((line) => line.points)) {
      this.width = Math.max(this.width, point.x);
      this.height = Math.max(this.height, point.y);
    }
  }

  shift(dx: number, dy: number): void {
    for (const node of this.nodes) {
      node.shift(dx, dy);
    }
    for (const eventSub of this.eventSubs) {
      eventSub.box.translate(dx, dy);
    }
    this.shiftArtifacts(dx, dy);
    this.shiftEdges(dx, dy);
    this.width += dx;
    this.height += dy;
  }

  private shiftArtifacts(dx: number, dy: number): void {
    const movedEnds = new Set<LinkEnd>();
    const moveEnd = (end: LinkEnd | undefined): void => {
      if (end?.flow && !movedEnds.has(end)) {
        movedEnds.add(end);
        end.box.translate(dx, dy);
      }
    };
    for (const artifact of this.artifacts) {
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
    for (const edge of this.edges) {
      new Polyline(edge.points).translate(dx, dy);
      edge.label?.translate(dx, dy);
      if (edge.bandY !== undefined) {
        edge.bandY += dy;
      }
    }
    for (const compensation of this.compensations) {
      new Polyline(compensation.points).translate(dx, dy);
    }
  }
}
