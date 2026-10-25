import type { Snapshot } from './Snapshot.js';
import type { IncrementalLayout } from './IncrementalLayout.js';
import { overlaps, segmentHits } from '../diagram/utils/geom.js';
import { hasExternalLabel } from '../diagram/utils/labels.js';
import { raw } from '../diagram/utils/raw.js';
import type { DEdge, DShape } from '../diagram/types.js';

/**
 * Labels of new and renamed elements and of rerouted named flows are placed; a kept label a new
 * line runs over, a grown activity covers or that is now on a sub-process title steps aside.
 */
export class LabelRefresh {
  constructor(
    private readonly run: IncrementalLayout,
    private readonly snap: Snapshot,
  ) {}

  labels(routed: ReadonlySet<string>): void {
    for (const plane of this.run.planes) {
      // segments of connections drawn in this run: an existing label they run over steps aside
      const fresh = [...plane.edges.values()].filter((e) => routed.has(e.id)).flatMap((e) => e.points.slice(1).map((q, i) => [e.points[i]!, q] as const));
      const grown = [...this.run.grown].map((id) => plane.shapes.get(id)).filter((g): g is DShape => !!g);
      for (const s of plane.shapes.values()) {
        if (this.run.fromEngine.has(s.id)) continue;
        if ((this.run.place.placed.has(s.id) && !s.label) || (this.run.place.relabel?.has(s.id) && hasExternalLabel(s))) {
          this.run.drawing(plane).placeShapeLabel(s);
          continue;
        }
        if (s.label && hasExternalLabel(s) && fresh.some(([p, q]) => segmentHits(p, q, s.label!, 1))) {
          this.run.drawing(plane).placeShapeLabel(s);
          this.run.notes.push(`label of ${s.id} moved off a new line`);
          continue;
        }
        if (s.label && hasExternalLabel(s) && grown.some((g) => g !== s && overlaps(s.label!, g.bounds))) {
          this.run.drawing(plane).placeShapeLabel(s);
          this.run.notes.push(`label of ${s.id} moved off a grown shape`);
          continue;
        }
        const before = this.snap.names.get(this.run.oldId(s));
        const now = raw<string>(s.el, 'name');
        if (now && now !== before) this.run.drawing(plane).refitLabel(s);
      }
      for (const e of plane.edges.values()) {
        if (this.run.fromEngine.has(e.id) || this.run.reroute.has(e.id)) continue;
        const before = this.snap.names.get(this.run.oldId(e));
        const now = raw<string>(e.el, 'name');
        if (now && now !== before) this.run.drawing(plane).refitLabel(e);
      }
      // a label now on the title of an expanded sub-process that it was clear of before the ops
      for (const [id, sub] of this.run.drawing(plane).clearTitles((o, sub) => !this.run.fromEngine.has(o.id) && this.clearOfOldTitle(o, sub))) this.run.notes.push(`label of ${id} moved off the name of ${sub}`);
    }
  }

  /** Whether a label was clear of the title of `sub` before the ops (a missing one was). */
  private clearOfOldTitle(owner: DShape | DEdge, sub: DShape): boolean {
    const label = owner.di ? this.snap.byDi.get(owner.di)?.label : undefined;
    const title = this.run.oldTitle(sub);
    return !label || !title || !overlaps(label, title);
  }
}
