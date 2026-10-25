import { copyBox, copyPoints } from './utils/geom.js';
import type { Box, Point, DEdge, DShape, Plane } from './types.js';

/** Everything a plane draws (bounds, labels, waypoints), to try something and undo it. */
export class PlaneCheckpoint {
  private readonly shapes = new Map<DShape, { bounds: Box; label?: Box }>();
  private readonly edges = new Map<DEdge, { points: Point[]; label?: Box }>();

  constructor(plane: Plane) {
    for (const s of plane.shapes.values()) this.shapes.set(s, { bounds: copyBox(s.bounds), ...(s.label ? { label: copyBox(s.label) } : {}) });
    for (const e of plane.edges.values()) this.edges.set(e, { points: copyPoints(e.points), ...(e.label ? { label: copyBox(e.label) } : {}) });
  }

  boundsOf(shape: DShape): Box {
    return this.shapes.get(shape)!.bounds;
  }

  /** A label added since is dropped. Can be called more than once. */
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
    }
  }
}
