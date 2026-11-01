import { Polyline } from '../../../model/index.js';
import type { DrawingSnapshot } from '../../DrawingSnapshot.js';
import type { DEdge } from '../../plane/DEdge.js';
import { DShape } from '../../plane/DShape.js';
import type { Drawing } from '../Drawing.js';
import type { LayoutRun } from './LayoutRun.js';

export class LabelRefresh {
  constructor(
    private readonly run: LayoutRun,
    private readonly before: DrawingSnapshot,
  ) {}

  labels(routed: ReadonlySet<string>): void {
    for (const plane of this.run.planes) {
      const fresh = [...plane.edges.values()].filter((edge) => routed.has(edge.id)).map((edge) => new Polyline(edge.points));
      const grown = [...this.run.grown].flatMap((id) => plane.shapes.get(id) ?? []);
      const drawing = this.run.drawing(plane);
      for (const shape of plane.shapes.values()) {
        if (!this.run.fromEngine.has(shape.id)) {
          this.refreshShape(drawing, shape, fresh, grown);
        }
      }
      for (const edge of plane.edges.values()) {
        if (!this.run.fromEngine.has(edge.id) && !this.run.reroute.has(edge.id)) {
          this.refreshRenamed(drawing, edge);
        }
      }
      const cleared = drawing.labels.clearTitles((element, sub) => !this.run.fromEngine.has(element.id) && this.clearOfOldTitle(element, sub));
      for (const [id, sub] of cleared) {
        this.run.notes.push(`label of ${id} moved off the name of ${sub}`);
      }
    }
  }

  private refreshShape(drawing: Drawing, shape: DShape, fresh: readonly Polyline[], grown: readonly DShape[]): void {
    const { label } = shape;
    const external = DShape.hasExternalLabel(shape.kind);
    const { labels } = drawing;
    if ((this.run.place.placed.has(shape.id) && !label) || (this.run.place.relabel.has(shape.id) && external)) {
      labels.placeShapeLabel(shape);
    } else if (label && external && fresh.some((line) => line.hits(label, 1))) {
      labels.placeShapeLabel(shape);
      this.run.notes.push(`label of ${shape.id} moved off a new line`);
    } else if (label && external && grown.some((other) => other !== shape && label.overlaps(other.bounds))) {
      labels.placeShapeLabel(shape);
      this.run.notes.push(`label of ${shape.id} moved off a grown shape`);
    } else {
      this.refreshRenamed(drawing, shape);
    }
  }

  private refreshRenamed(drawing: Drawing, owner: DShape | DEdge): void {
    const name = owner.el.peek<string>('name');
    if (name && name !== this.before.names.get(this.run.oldId(owner))) {
      drawing.labels.refitLabel(owner);
    }
  }

  private clearOfOldTitle(owner: DShape | DEdge, sub: DShape): boolean {
    const label = owner.di ? this.before.byDi.get(owner.di)?.label : undefined;
    const title = this.run.oldTitle(sub);
    return !label || !title || !label.overlaps(title);
  }
}
