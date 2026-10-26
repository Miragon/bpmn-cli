import { copyBox, copyPoints } from './utils/geom.js';
import type { Box, Point, DEdge, DShape, Plane } from './types.js';

interface SavedEdge {
  points: Point[];
  label?: Box;
  sourceId?: string;
  targetId?: string;
}

/** What shapes and edges draw (bounds, labels, waypoints, ends), to try something and undo it. */
export class DrawingCheckpoint {
  private readonly shapes = new Map<DShape, { bounds: Box; label?: Box }>();
  private readonly edges = new Map<DEdge, SavedEdge>();

  constructor(plane?: Plane) {
    if (plane) this.keepPlane(plane);
  }

  keepPlane(plane: Plane): void {
    plane.shapes.forEach((shape) => this.keepShape(shape));
    plane.edges.forEach((edge) => this.keepEdge(edge));
  }

  /** The first state kept of a shape wins. */
  keepShape(shape: DShape): void {
    if (!this.shapes.has(shape)) this.shapes.set(shape, { bounds: copyBox(shape.bounds), ...(shape.label ? { label: copyBox(shape.label) } : {}) });
  }

  /** The first state kept of an edge wins. */
  keepEdge(edge: DEdge): void {
    if (this.edges.has(edge)) return;
    this.edges.set(edge, { points: copyPoints(edge.points), ...(edge.label ? { label: copyBox(edge.label) } : {}), ...(edge.sourceId ? { sourceId: edge.sourceId } : {}), ...(edge.targetId ? { targetId: edge.targetId } : {}) });
  }

  boundsOf(shape: DShape): Box {
    return this.shapes.get(shape)!.bounds;
  }

  /** A label or end added since is dropped. Can be called more than once. */
  restore(): void {
    for (const [shape, saved] of this.shapes) {
      shape.bounds = copyBox(saved.bounds);
      if (saved.label) shape.label = copyBox(saved.label);
      else delete shape.label;
    }
    for (const [edge, saved] of this.edges) {
      edge.points = copyPoints(saved.points);
      if (saved.label) edge.label = copyBox(saved.label);
      else delete edge.label;
      if (saved.sourceId) edge.sourceId = saved.sourceId;
      else delete edge.sourceId;
      if (saved.targetId) edge.targetId = saved.targetId;
      else delete edge.targetId;
    }
  }
}
