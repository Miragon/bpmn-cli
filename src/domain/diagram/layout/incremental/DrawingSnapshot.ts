import type { Drawing } from './Drawing.js';
import type { EdgeBefore } from './EdgeRouter.js';
import type { Box, DEdge, DShape, Point } from '../../di/types.js';
import { copyBox, copyPoints, overlaps, sameBox, samePoints } from '../../utils/geom.js';
import { raw } from '../../utils/raw.js';
import { titleBox } from '../../utils/text.js';

/** What the planes of a drawing showed before a format op, to compare against afterwards. */
export class DrawingSnapshot {
  readonly bounds = new Map<string, Box>();
  readonly points = new Map<string, Point[]>();
  readonly edges = new Map<DEdge, EdgeBefore>();
  readonly labels = new Map<string, Box>();

  constructor(private readonly drawings: readonly Drawing[]) {
    for (const drawing of drawings) {
      for (const shape of drawing.plane.shapes.values()) {
        this.bounds.set(shape.id, copyBox(shape.bounds));
        if (shape.label) this.labels.set(shape.id, copyBox(shape.label));
      }
      for (const edge of drawing.plane.edges.values()) {
        this.points.set(edge.id, copyPoints(edge.points));
        this.edges.set(edge, drawing.edgeBefore(edge));
        if (edge.label) this.labels.set(edge.id, copyBox(edge.label));
      }
    }
  }

  unchanged(edge: DEdge): boolean {
    const old = this.points.get(edge.id);
    return !!old && samePoints(old, edge.points);
  }

  /** Uses the current name with the old bounds: a format op renames nothing. */
  clearOfTitle(owner: DShape | DEdge, sub: DShape): boolean {
    const label = this.labels.get(owner.id);
    const bounds = this.bounds.get(sub.id);
    const title = bounds ? titleBox(bounds, raw<string>(sub.el, 'name')) : undefined;
    return !label || !title || !overlaps(label, title);
  }

  changedShapes(): string[] {
    const out: string[] = [];
    for (const drawing of this.drawings) {
      for (const shape of drawing.plane.shapes.values()) {
        const box = this.bounds.get(shape.id);
        if (box && !sameBox(box, shape.bounds)) out.push(shape.id);
      }
    }
    return out;
  }

  changedEdges(): string[] {
    const out: string[] = [];
    for (const drawing of this.drawings) {
      for (const edge of drawing.plane.edges.values()) {
        const points = this.points.get(edge.id);
        if (points && !samePoints(points, edge.points)) out.push(edge.id);
      }
    }
    return out;
  }
}
