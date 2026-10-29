import type { Snapshot } from './Snapshot.js';
import type { IncrementalLayout } from './IncrementalLayout.js';
import { overlaps, pathHits } from '../../utils/geom.js';
import { hasExternalLabel } from '../../utils/labels.js';
import { raw } from '../../utils/raw.js';
import type { DEdge, DShape } from '../../di/types.js';

/**
 * Labels of new and renamed elements and of rerouted named flows are placed; a kept label a new
 * line runs over, a grown activity covers or that is now on a sub-process title steps aside.
 */
export class LabelRefresh {
  constructor(
    private readonly run: IncrementalLayout,
    private readonly snap: Snapshot,
  ) {}

  /**
   * An existing label that connections drawn in this run run over steps aside, as does one now on
   * the title of an expanded sub-process that it was clear of before the ops.
   */
  labels(routed: ReadonlySet<string>): void {
    for (const plane of this.run.planes) {
      const fresh = [...plane.edges.values()].filter((edge) => routed.has(edge.id));
      const grown = [...this.run.grown].map((id) => plane.shapes.get(id)).filter((shape): shape is DShape => !!shape);
      for (const shape of plane.shapes.values()) {
        if (this.run.fromEngine.has(shape.id)) continue;
        if ((this.run.place.placed.has(shape.id) && !shape.label) || (this.run.place.relabel?.has(shape.id) && hasExternalLabel(shape))) {
          this.run.drawing(plane).placeShapeLabel(shape);
          continue;
        }
        if (shape.label && hasExternalLabel(shape) && fresh.some((edge) => pathHits(edge.points, shape.label!, 1))) {
          this.run.drawing(plane).placeShapeLabel(shape);
          this.run.notes.push(`label of ${shape.id} moved off a new line`);
          continue;
        }
        if (shape.label && hasExternalLabel(shape) && grown.some((grownShape) => grownShape !== shape && overlaps(shape.label!, grownShape.bounds))) {
          this.run.drawing(plane).placeShapeLabel(shape);
          this.run.notes.push(`label of ${shape.id} moved off a grown shape`);
          continue;
        }
        const before = this.snap.names.get(this.run.oldId(shape));
        const now = raw<string>(shape.el, 'name');
        if (now && now !== before) this.run.drawing(plane).refitLabel(shape);
      }
      for (const edge of plane.edges.values()) {
        if (this.run.fromEngine.has(edge.id) || this.run.reroute.has(edge.id)) continue;
        const before = this.snap.names.get(this.run.oldId(edge));
        const now = raw<string>(edge.el, 'name');
        if (now && now !== before) this.run.drawing(plane).refitLabel(edge);
      }
      for (const [id, sub] of this.run.drawing(plane).clearTitles((element, sub) => !this.run.fromEngine.has(element.id) && this.clearOfOldTitle(element, sub))) {
        this.run.notes.push(`label of ${id} moved off the name of ${sub}`);
      }
    }
  }

  /** Whether a label was clear of the title of `sub` before the ops (a missing one was). */
  private clearOfOldTitle(owner: DShape | DEdge, sub: DShape): boolean {
    const label = owner.di ? this.snap.byDi.get(owner.di)?.label : undefined;
    const title = this.run.oldTitle(sub);
    return !label || !title || !overlaps(label, title);
  }
}
