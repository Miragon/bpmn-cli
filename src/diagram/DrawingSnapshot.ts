import type { Drawing } from './Drawing.js';
import type { EdgeBefore } from './EdgeRouter.js';
import type { Box, DEdge, DShape, Point } from './types.js';
import { copyBox, copyPoints, overlaps, sameBox, samePoints } from './utils/geom.js';
import { raw } from './utils/plane.js';
import { titleBox } from './utils/text.js';

/** What the planes of a drawing showed before an edit (a format op): bounds, waypoints, labels by element id, and every connection's state for brokenEdge. */
export class DrawingSnapshot {
  readonly bounds = new Map<string, Box>();
  readonly points = new Map<string, Point[]>();
  readonly edges = new Map<DEdge, EdgeBefore>();
  /** external labels of shapes and connections, by element id */
  readonly labels = new Map<string, Box>();

  constructor(private readonly drawings: readonly Drawing[]) {
    for (const d of drawings) {
      for (const s of d.plane.shapes.values()) {
        this.bounds.set(s.id, copyBox(s.bounds));
        if (s.label) this.labels.set(s.id, copyBox(s.label));
      }
      for (const e of d.plane.edges.values()) {
        this.points.set(e.id, copyPoints(e.points));
        this.edges.set(e, d.edgeBefore(e));
        if (e.label) this.labels.set(e.id, copyBox(e.label));
      }
    }
  }

  /** A connection still has the waypoints it had. */
  unchanged(e: DEdge): boolean {
    const old = this.points.get(e.id);
    return !!old && samePoints(old, e.points);
  }

  /** Whether a label was clear of the title of an expanded sub-process before (snapshot bounds; a format op renames nothing). */
  clearOfTitle(owner: DShape | DEdge, sub: DShape): boolean {
    const label = this.labels.get(owner.id);
    const bounds = this.bounds.get(sub.id);
    const title = bounds ? titleBox(bounds, raw<string>(sub.el, 'name')) : undefined;
    return !label || !title || !overlaps(label, title);
  }

  /** Shapes whose bounds changed since. */
  changedShapes(): string[] {
    const out: string[] = [];
    for (const d of this.drawings) {
      for (const s of d.plane.shapes.values()) {
        const b = this.bounds.get(s.id);
        if (b && !sameBox(b, s.bounds)) out.push(s.id);
      }
    }
    return out;
  }

  /** Connections whose waypoints changed since. */
  changedEdges(): string[] {
    const out: string[] = [];
    for (const d of this.drawings) {
      for (const e of d.plane.edges.values()) {
        const p = this.points.get(e.id);
        if (p && !samePoints(p, e.points)) out.push(e.id);
      }
    }
    return out;
  }
}
