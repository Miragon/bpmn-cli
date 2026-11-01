import { Box, Segment, type Point } from '../../../model/index.js';
import type { DEdge } from '../../plane/DEdge.js';
import type { DShape } from '../../plane/DShape.js';
import type { Plane } from '../../plane/Plane.js';

export interface PushRequest {
  line: number;
  delta: number;
  successor: DShape | undefined;
  id?: string;
  box?: Box;
  fixed?: ReadonlySet<string> | undefined;
}

export class PushSet {
  private static readonly CLEAR = 20;
  private static readonly LABEL_CLEAR = 4;
  private static readonly BEND_CLEAR = 10;

  private readonly pushed = new Set<string>();
  private readonly next = new Map<string, string[]>();
  private readonly links = new Map<string, string[]>();
  private readonly queue: DShape[] = [];
  private solids: Box[] = [];
  private labels: Box[] = [];

  constructor(
    private readonly plane: Plane,
    private readonly request: PushRequest,
    private readonly unitBox: (shape: DShape) => Box,
  ) {
    for (const edge of plane.edges.values()) {
      this.indexEdge(edge);
    }
  }

  private static append(map: Map<string, string[]>, from: string, to: string): void {
    const list = map.get(from);
    if (list) {
      list.push(to);
    } else {
      map.set(from, [to]);
    }
  }

  collect(): Set<string> {
    this.take(this.request.successor);
    this.drain();
    const { shapes, edges } = this.plane;
    for (let grew = true, guard = 0; grew && guard <= shapes.size + edges.size; guard++) {
      this.notePushed();
      const groups = this.takeGroups();
      const near = this.takeShapesNear();
      const crossing = this.takeCrossedEdges();
      grew = groups || near || crossing;
      this.drain();
    }
    return this.pushed;
  }

  private indexEdge({ kind, sourceId, targetId }: DEdge): void {
    if (!sourceId || !targetId) {
      return;
    }
    if (kind === 'sequenceFlow') {
      PushSet.append(this.next, sourceId, targetId);
    }
    if (kind === 'association' || kind === 'dataAssociation') {
      PushSet.append(this.links, sourceId, targetId);
      PushSet.append(this.links, targetId, sourceId);
    }
  }

  private movable(shape: DShape): boolean {
    const { line, fixed } = this.request;
    const { kind, bounds, container } = shape;
    return !fixed?.has(shape.id) && !shape.hostId && !shape.parentId && kind !== 'participant' && kind !== 'lane' && kind !== 'group' && (bounds.x >= line || (container && bounds.center.x >= line));
  }

  private take(shape: DShape | undefined): void {
    if (shape && !this.pushed.has(shape.id) && this.movable(shape)) {
      this.pushed.add(shape.id);
      this.queue.push(shape);
    }
  }

  private drain(): void {
    for (let shape = this.queue.shift(); shape; shape = this.queue.shift()) {
      const dragged = [shape, ...this.plane.boundariesOf(shape.id), ...(shape.container ? this.plane.contentOf(shape.id).shapes : [])];
      dragged.forEach((part) => this.pushed.add(part.id));
      for (const part of dragged) {
        this.followFrom(part);
      }
    }
  }

  private followFrom(part: DShape): void {
    for (const target of this.next.get(part.id) ?? []) {
      this.take(this.plane.shapes.get(target));
    }
    for (const other of this.links.get(part.id) ?? []) {
      const artifact = this.plane.shapes.get(other);
      if (artifact?.kind === 'annotation' || artifact?.kind === 'data') {
        this.take(artifact);
      }
    }
  }

  private notePushed(): void {
    const shapes = [...this.pushed].flatMap((id) => this.plane.shapes.get(id) ?? []);
    const { box } = this.request;
    this.solids = [...(box ? [box] : []), ...shapes.map((shape) => shape.bounds)];
    this.labels = shapes.flatMap((shape) => shape.label ?? []);
  }

  private swept(before: Box): Box {
    return before === this.request.box ? before : new Box(before.x, before.y, before.width + this.request.delta, before.height);
  }

  private closer(before: Box, other: Box, margin: number): boolean {
    const swept = this.swept(before);
    if (!swept.overlaps(other, margin)) {
      return false;
    }
    return before === this.request.box || !before.overlaps(other, margin) || other.x >= before.right - 1 || (swept.overlaps(other) && !before.overlaps(other));
  }

  private hits(other: Box, margin: number): boolean {
    return this.solids.some((before) => this.closer(before, other, margin)) || this.labels.some((before) => this.closer(before, other, PushSet.LABEL_CLEAR));
  }

  private takeGroups(): boolean {
    const shapes = [...this.plane.shapes.values()];
    const pushedLeaves = [...this.pushed].flatMap((id) => this.plane.shapes.get(id) ?? []).filter((shape) => shape.isLeaf);
    let grew = false;
    for (const group of shapes) {
      if (group.kind === 'group' && !this.pushed.has(group.id) && pushedLeaves.some((shape) => group.bounds.contains(shape.bounds.center))) {
        this.pushed.add(group.id);
        grew = true;
        if (group.bounds.x >= this.request.line) {
          shapes.filter((member) => group.bounds.contains(member.bounds.center)).forEach((member) => this.take(member));
        }
      }
    }
    return grew;
  }

  private takeShapesNear(): boolean {
    let grew = false;
    for (const shape of this.plane.shapes.values()) {
      if (!this.pushed.has(shape.id) && this.movable(shape) && this.comesClose(shape)) {
        this.take(shape);
        grew = true;
      }
    }
    return grew;
  }

  private comesClose(shape: DShape): boolean {
    const ownLabels = [shape, ...this.plane.boundariesOf(shape.id)].flatMap((part) => part.label ?? []);
    return this.hits(this.unitBox(shape), PushSet.CLEAR) || ownLabels.some((label) => this.hits(label, PushSet.LABEL_CLEAR));
  }

  private takeCrossedEdges(): boolean {
    let grew = false;
    for (const edge of this.plane.edges.values()) {
      if (this.isCrossed(edge)) {
        this.pushed.add(edge.id);
        this.take(this.plane.shapes.get(edge.sourceId!));
        this.take(this.plane.shapes.get(edge.targetId!));
        grew = true;
      }
    }
    return grew;
  }

  private isCrossed(edge: DEdge): boolean {
    const { sourceId, targetId, points, label } = edge;
    if (this.pushed.has(edge.id) || [sourceId, targetId].some((end) => !end || end === this.request.id || this.pushed.has(end))) {
      return false;
    }
    return this.bendsInBox(points) || this.sweptOver(points) || (!!label && this.hits(label, PushSet.LABEL_CLEAR));
  }

  private bendsInBox(points: readonly Point[]): boolean {
    const { box } = this.request;
    return !!box && points.slice(1, -1).some(({ x, y }) => new Box(x, y, 0, 0).overlaps(box, PushSet.BEND_CLEAR));
  }

  private sweptOver(points: readonly Point[]): boolean {
    const { box } = this.request;
    return points.some((point, index) => {
      if (index === 0) {
        return false;
      }
      const segment = new Segment(points[index - 1]!, point);
      return this.solids.some((before) => segment.hits(this.swept(before)) && (before === box || !segment.hits(before)));
    });
  }
}
