import type { Snapshot } from './Snapshot.js';
import type { IncrementalLayout } from './IncrementalLayout.js';
import { is } from '../../model/utils/moddle.js';
import { bottom, copyBox, cy, inside, overlaps, right, type Box } from '../../drawing/utils/geom.js';
import { raw } from '../../drawing/utils/raw.js';
import { Frames } from '../../drawing/Frames.js';
import { PlaneQuery } from '../../drawing/PlaneQuery.js';
import type { DShape, Plane } from '../../drawing/types.js';
import { attachedSide } from '../../drawing/utils/sides.js';
import { activitySize, BOTTOM_ROOM } from '../../drawing/utils/text.js';

/**
 * Room for what was placed and renamed: activities grow to fit a new name, expanded sub-processes
 * for a longer title, groups around new nodes, and overlaps around everything placed or moved are
 * removed.
 */
export class FrameGrowth {
  constructor(
    private readonly run: IncrementalLayout,
    private readonly snap: Snapshot,
    /** shape bounds before anything moved */
    private readonly baseline: Map<string, Box>,
  ) {}

  /** Room kept free below an activity's text for a marker or boundary events on its bottom. */
  private textRoom(plane: Plane, s: DShape): number {
    const marker = s.kind === 'subProcess' || is(s.el, 'bpmn:CallActivity') || !!raw(s.el, 'loopCharacteristics') || raw<boolean>(s.el, 'isForCompensation') === true;
    const below = PlaneQuery.boundariesOf(plane, s.id).some((b) => attachedSide(b.bounds, s.bounds) === 'bottom');
    return marker || below ? BOTTOM_ROOM : 0;
  }

  /**
   * A renamed expanded sub-process whose title now takes more lines and reaches down to what is
   * drawn under it: the content moves down by the difference, at most by the depth the title
   * gained (space tool in frame mode).
   */
  private growForTitle(plane: Plane, s: DShape): void {
    const title = Frames.title(s);
    if (!title) return;
    const old = this.run.oldTitle(s);
    // the depth the title gained: its new lines, all of it where none was drawn
    const gained = old ? title.height - old.height : bottom(title) - s.bounds.y;
    if (gained <= 0) return;
    const { shapes, edges } = PlaneQuery.contentOf(plane, s.id);
    // a message flow's label between the pools is no content, even when the flow leaves the content
    const under = (b: Box): boolean => b.y >= s.bounds.y && b.y < bottom(s.bounds) && b.x < right(title) + 2 && right(b) > title.x - 2;
    const boxes = [...shapes.flatMap((c) => [c.bounds, ...(c.label ? [c.label] : [])]), ...edges.flatMap((e) => (e.label ? [e.label] : []))].filter(under);
    if (!boxes.length) return;
    const delta = Math.ceil(Math.min(gained, bottom(title) + 4 - Math.min(...boxes.map((b) => b.y))));
    if (delta <= 0) return;
    const r = this.run.drawing(plane).makeSpace({ axis: 'y', line: s.bounds.y + 1, delta, anchors: [s.id], frame: s.id, within: copyBox(s.bounds) });
    for (const x of [...r.moved, ...r.resized]) this.run.place.moved.add(x);
    this.run.place.moved.add(s.id);
    this.run.notes.push(`${s.id} made ${delta} px of room below its new title`);
  }

  /**
   * An activity whose new name does not fit grows (wider up to 200 px, then higher, never smaller;
   * the space tool makes room on its row); an expanded sub-process grows for its title.
   */
  growForNames(): void {
    for (const plane of this.run.planes) {
      const sp = this.run.place.spacing.get(plane) ?? PlaneQuery.spacingOf(plane);
      for (const s of [...plane.shapes.values()]) {
        if (this.run.fromEngine.has(s.id) || (s.kind !== 'task' && s.kind !== 'subProcess')) continue;
        const name = raw<string>(s.el, 'name');
        if (!name || name === this.snap.names.get(this.run.oldId(s))) continue;
        if (s.container) {
          this.growForTitle(plane, s);
          continue;
        }
        const size = activitySize(name, s.bounds, this.textRoom(plane, s));
        if (!size) continue;
        const old = copyBox(s.bounds);
        const own = new Set([s.id, ...PlaneQuery.boundariesOf(plane, s.id).map((b) => b.id)]);
        const dw = size.width - old.width;
        if (dw > 0) {
          // what follows on the row keeps the drawing's gap (at most 40 px), else space is made
          const top = cy(old) - size.height / 2;
          const onRow = (b: Box): boolean => b.y < top + size.height + 10 && bottom(b) > top - 10;
          const next = [...plane.shapes.values()].filter((o) => !own.has(o.id) && (PlaneQuery.isLeaf(o) || (o.kind === 'subProcess' && o.container && !Frames.within(plane, s, o))) && o.bounds.x >= right(old) - 0.5 && onRow(o.bounds));
          const lefts = next.flatMap((o) => [o.bounds.x, ...(o.label && onRow(o.label) && right(o.label) > right(old) ? [Math.max(right(old), o.label.x)] : [])]);
          const free = Math.min(Infinity, ...lefts.map((x) => x - right(old)));
          if (free - dw < Math.min(sp.gap, 40)) {
            // inside a sub-process: frame mode, it never grows over foreign shapes
            const sub = s.parentId ? plane.shapes.get(s.parentId) : undefined;
            const frame = sub ?? (s.poolId ? plane.shapes.get(s.poolId) : undefined);
            const r = this.run.drawing(plane).makeSpace({ axis: 'x', line: right(old) + 0.5, delta: dw, keep: own, anchors: [s.id], ...(frame ? { within: copyBox(frame.bounds) } : {}), ...(sub ? { frame: sub.id } : {}) });
            for (const x of [...r.moved, ...r.resized]) this.run.place.moved.add(x);
          }
        }
        s.bounds = { x: old.x, y: Math.round(cy(old) - size.height / 2), width: size.width, height: size.height };
        // never above its frame's interior (fitInFrame grows the frame at the right / bottom)
        const frame = Frames.of(plane, s);
        const inner = frame ? Frames.interior(frame, 15) : undefined;
        if (inner && s.bounds.y < inner.y) s.bounds.y = Math.round(inner.y);
        this.run.drawing(plane).reseatBoundaries(s, old);
        for (const x of this.run.drawing(plane).fitInFrame(s.id, 15).moved) this.run.place.moved.add(x);
        this.run.active.add(s.id);
        this.run.place.moved.add(s.id);
        this.run.grown.add(s.id);
        this.run.notes.push(`${s.id} grew to ${size.width}x${size.height} to fit its name`);
      }
    }
  }

  private neighbourIds(id: string): string[] {
    return [...this.run.sem.predecessors(id), ...this.run.sem.successors(id)];
  }

  /** Local overlap removal around everything placed or moved. */
  separateAll(): void {
    const changed = new Set([...this.run.place.placed, ...this.run.active, ...this.run.place.moved]);
    for (const plane of this.run.planes) {
      const active = [...changed].filter((id) => plane.shapes.has(id) && !this.run.fromEngine.has(id));
      if (!active.length) continue;
      const movable = new Set(active);
      for (const id of active) for (const n of this.neighbourIds(id)) if (plane.shapes.has(n)) movable.add(n);
      const r = this.run.drawing(plane).separate({ active: [...active].filter((id) => this.run.place.placed.has(id) || this.run.active.has(id)), movable, baseline: this.baseline });
      r.moved.forEach((x) => this.run.place.moved.add(x));
      r.resized.forEach((x) => this.run.place.moved.add(x));
      if (r.unresolved.length) this.run.notes.push(`overlap left: ${r.unresolved.map(([a, b]) => `${a}~${b}`).join(', ')}`);
    }
  }

  /** A new node reaching over a group's border grows the group (half in reads as neither). */
  growGroups(): void {
    for (const plane of this.run.planes) {
      const groups = [...plane.shapes.values()].filter((g) => g.kind === 'group');
      if (!groups.length) continue;
      for (const id of this.run.place.placed) {
        const s = plane.shapes.get(id);
        if (!s || !PlaneQuery.isLeaf(s) || s.kind === 'boundary') continue;
        for (const g of groups) {
          const b = g.bounds;
          if (!overlaps(s.bounds, b) || inside(s.bounds, b, 10)) continue;
          const pad = 15;
          const x = Math.min(b.x, s.bounds.x - pad);
          const y = Math.min(b.y, s.bounds.y - pad);
          g.bounds = { x, y, width: Math.max(right(b), right(s.bounds) + pad) - x, height: Math.max(b.y + b.height, s.bounds.y + s.bounds.height + pad) - y };
          this.run.place.moved.add(g.id);
        }
      }
    }
  }
}
