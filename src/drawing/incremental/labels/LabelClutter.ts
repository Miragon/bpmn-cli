import { Point, Polyline, Segment, type Box } from '../../../model/index.js';
import { DrawnPlane } from '../../../scoring/index.js';
import { Frames } from '../../plane/Frames.js';
import type { Plane } from '../../plane/Plane.js';
import { Semantics } from '../../plane/Semantics.js';

export class LabelClutter {
  readonly shapes: Box[] = [];
  private readonly labels: Box[] = [];
  private readonly segments: Segment[] = [];
  private readonly crossing: Segment[] = [];

  constructor(
    private readonly plane: Plane,
    private readonly ownerId: string,
    ignoreShapes: ReadonlySet<string>,
  ) {
    this.noteShapes(ignoreShapes);
    this.noteEdges();
  }

  private static outline({ x, y, right, bottom }: Box): Segment[] {
    const topLeft = new Point(x, y), topRight = new Point(right, y), bottomRight = new Point(right, bottom), bottomLeft = new Point(x, bottom);
    return [new Segment(topLeft, topRight), new Segment(topRight, bottomRight), new Segment(bottomRight, bottomLeft), new Segment(bottomLeft, topLeft)];
  }

  collides(candidate: Box, name?: string): boolean {
    const onLine = (segment: Segment): boolean => segment.hits(candidate, 1);
    if (this.shapes.some((shape) => shape.overlaps(candidate, 2)) || this.labels.some((label) => label.overlaps(candidate, 2)) || this.segments.some(onLine) || this.crossing.some(onLine)) {
      return true;
    }
    if (!name) {
      return false;
    }
    const text = DrawnPlane.glyph(candidate, name);
    return this.shapes.some((shape) => shape.overlaps(text)) || this.segments.some((segment) => segment.hits(text, 0));
  }

  private noteShapes(ignoreShapes: ReadonlySet<string>): void {
    for (const shape of this.plane.shapes.values()) {
      if (!shape.container && shape.kind !== 'group' && !ignoreShapes.has(shape.id)) {
        this.shapes.push(shape.bounds);
      }
      if (shape.label && shape.id !== this.ownerId) {
        this.labels.push(shape.label);
      }
      const title = Frames.title(shape);
      if (title) {
        this.shapes.push(title);
      }
      if (shape.container) {
        this.segments.push(...LabelClutter.outline(shape.bounds));
      }
    }
  }

  private noteEdges(): void {
    const edges = [...this.plane.edges.values()];
    const own = edges.filter((edge) => (edge.sourceId === this.ownerId || edge.targetId === this.ownerId) && !Semantics.isAnnotationLine(edge.el));
    for (const edge of edges) {
      if (edge.label && edge.id !== this.ownerId) {
        this.labels.push(edge.label);
      }
      const line = new Polyline(edge.points);
      const crosses = !own.includes(edge) && !Semantics.isAnnotationLine(edge.el) && own.some((mine) => new Polyline(mine.points).crosses(line));
      (crosses ? this.crossing : this.segments).push(...line.segments());
    }
  }
}
