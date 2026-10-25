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
    plane.shapes.forEach((s) => this.keepShape(s));
    plane.edges.forEach((e) => this.keepEdge(e));
  }

  /** The first state kept of a shape wins. */
  keepShape(s: DShape): void {
    if (!this.shapes.has(s)) this.shapes.set(s, { bounds: copyBox(s.bounds), ...(s.label ? { label: copyBox(s.label) } : {}) });
  }

  /** The first state kept of an edge wins. */
  keepEdge(e: DEdge): void {
    if (this.edges.has(e)) return;
    this.edges.set(e, { points: copyPoints(e.points), ...(e.label ? { label: copyBox(e.label) } : {}), ...(e.sourceId ? { sourceId: e.sourceId } : {}), ...(e.targetId ? { targetId: e.targetId } : {}) });
  }

  boundsOf(shape: DShape): Box {
    return this.shapes.get(shape)!.bounds;
  }

  /** A label or end added since is dropped. Can be called more than once. */
  restore(): void {
    for (const [s, v] of this.shapes) {
      s.bounds = copyBox(v.bounds);
      if (v.label) s.label = copyBox(v.label);
      else delete s.label;
    }
    for (const [e, v] of this.edges) {
      e.points = copyPoints(v.points);
      if (v.label) e.label = copyBox(v.label);
      else delete e.label;
      if (v.sourceId) e.sourceId = v.sourceId;
      else delete e.sourceId;
      if (v.targetId) e.targetId = v.targetId;
      else delete e.targetId;
    }
  }
}
