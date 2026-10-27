import type { Snapshot } from './Snapshot.js';
import type { IncrementalLayout } from './IncrementalLayout.js';
import { is } from '../../../document/utils/moddle.js';
import { bottom, copyBox, cy, inside, overlaps, right, type Box } from '../../utils/geom.js';
import { raw } from '../../utils/raw.js';
import { Frames } from '../../di/Frames.js';
import { PlaneQuery } from '../../di/PlaneQuery.js';
import type { DShape, Plane } from '../../di/types.js';
import { attachedSide } from '../../utils/sides.js';
import { activitySize, BOTTOM_ROOM } from '../../utils/text.js';

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
  private textRoom(plane: Plane, shape: DShape): number {
    const marker = shape.kind === 'subProcess' || is(shape.el, 'bpmn:CallActivity') || !!raw(shape.el, 'loopCharacteristics') || raw<boolean>(shape.el, 'isForCompensation') === true;
    const below = PlaneQuery.boundariesOf(plane, shape.id).some((boundary) => attachedSide(boundary.bounds, shape.bounds) === 'bottom');
    return marker || below ? BOTTOM_ROOM : 0;
  }

  /**
   * A renamed expanded sub-process whose title now takes more lines and reaches down to what is
   * drawn under it: the content moves down by the difference, at most by the depth the title
   * gained (space tool in frame mode).
   * Where no title was drawn the whole title counts as gained. A message flow's label between the
   * pools is no content, even when the flow leaves the content.
   */
  private growForTitle(plane: Plane, shape: DShape): void {
    const title = Frames.title(shape);
    if (!title) return;
    const old = this.run.oldTitle(shape);
    const gained = old ? title.height - old.height : bottom(title) - shape.bounds.y;
    if (gained <= 0) return;
    const { shapes, edges } = PlaneQuery.contentOf(plane, shape.id);
    const under = (box: Box): boolean => box.y >= shape.bounds.y && box.y < bottom(shape.bounds) && box.x < right(title) + 2 && right(box) > title.x - 2;
    const boxes = [...shapes.flatMap((child) => [child.bounds, ...(child.label ? [child.label] : [])]), ...edges.flatMap((edge) => (edge.label ? [edge.label] : []))].filter(under);
    if (!boxes.length) return;
    const delta = Math.ceil(Math.min(gained, bottom(title) + 4 - Math.min(...boxes.map((box) => box.y))));
    if (delta <= 0) return;
    const result = this.run.drawing(plane).makeSpace({ axis: 'y', line: shape.bounds.y + 1, delta, anchors: [shape.id], frame: shape.id, within: copyBox(shape.bounds) });
    for (const movedId of [...result.moved, ...result.resized]) this.run.place.moved.add(movedId);
    this.run.place.moved.add(shape.id);
    this.run.notes.push(`${shape.id} made ${delta} px of room below its new title`);
  }

  /**
   * An activity whose new name does not fit grows (wider up to 200 px, then higher, never smaller;
   * the space tool makes room on its row); an expanded sub-process grows for its title.
   * What follows on the row keeps the drawing's gap (at most 40 px), else space is made (in frame
   * mode inside a sub-process). A shape never grows above its frame's interior, as fitInFrame grows
   * the frame only at the right / bottom.
   */
  growForNames(): void {
    for (const plane of this.run.planes) {
      const sp = this.run.place.spacing.get(plane) ?? PlaneQuery.spacingOf(plane);
      for (const shape of [...plane.shapes.values()]) {
        if (this.run.fromEngine.has(shape.id) || (shape.kind !== 'task' && shape.kind !== 'subProcess')) continue;
        const name = raw<string>(shape.el, 'name');
        if (!name || name === this.snap.names.get(this.run.oldId(shape))) continue;
        if (shape.container) {
          this.growForTitle(plane, shape);
          continue;
        }
        const size = activitySize(name, shape.bounds, this.textRoom(plane, shape));
        if (!size) continue;
        const old = copyBox(shape.bounds);
        const own = new Set([shape.id, ...PlaneQuery.boundariesOf(plane, shape.id).map((boundary) => boundary.id)]);
        const dw = size.width - old.width;
        if (dw > 0) {
          const top = cy(old) - size.height / 2;
          const onRow = (box: Box): boolean => box.y < top + size.height + 10 && bottom(box) > top - 10;
          const next = [...plane.shapes.values()].filter((other) => !own.has(other.id) && (PlaneQuery.isLeaf(other) || (other.kind === 'subProcess' && other.container && !Frames.within(plane, shape, other))) && other.bounds.x >= right(old) - 0.5 && onRow(other.bounds));
          const lefts = next.flatMap((other) => [other.bounds.x, ...(other.label && onRow(other.label) && right(other.label) > right(old) ? [Math.max(right(old), other.label.x)] : [])]);
          const free = Math.min(Infinity, ...lefts.map((left) => left - right(old)));
          if (free - dw < Math.min(sp.gap, 40)) {
            const sub = shape.parentId ? plane.shapes.get(shape.parentId) : undefined;
            const frame = sub ?? (shape.poolId ? plane.shapes.get(shape.poolId) : undefined);
            const result = this.run.drawing(plane).makeSpace({ axis: 'x', line: right(old) + 0.5, delta: dw, keep: own, anchors: [shape.id], ...(frame ? { within: copyBox(frame.bounds) } : {}), ...(sub ? { frame: sub.id } : {}) });
            for (const movedId of [...result.moved, ...result.resized]) this.run.place.moved.add(movedId);
          }
        }
        shape.bounds = { x: old.x, y: Math.round(cy(old) - size.height / 2), width: size.width, height: size.height };
        const frame = Frames.of(plane, shape);
        const inner = frame ? Frames.interior(frame, 15) : undefined;
        if (inner && shape.bounds.y < inner.y) shape.bounds.y = Math.round(inner.y);
        this.run.drawing(plane).reseatBoundaries(shape, old);
        for (const movedId of this.run.drawing(plane).fitInFrame(shape.id, 15).moved) this.run.place.moved.add(movedId);
        this.run.active.add(shape.id);
        this.run.place.moved.add(shape.id);
        this.run.grown.add(shape.id);
        this.run.notes.push(`${shape.id} grew to ${size.width}x${size.height} to fit its name`);
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
      for (const id of active) for (const neighbourId of this.neighbourIds(id)) if (plane.shapes.has(neighbourId)) movable.add(neighbourId);
      const result = this.run.drawing(plane).separate({ active: [...active].filter((id) => this.run.place.placed.has(id) || this.run.active.has(id)), movable, baseline: this.baseline });
      result.moved.forEach((movedId) => this.run.place.moved.add(movedId));
      result.resized.forEach((resizedId) => this.run.place.moved.add(resizedId));
      if (result.unresolved.length) this.run.notes.push(`overlap left: ${result.unresolved.map(([firstId, secondId]) => `${firstId}~${secondId}`).join(', ')}`);
    }
  }

  /** A new node reaching over a group's border grows the group (half in reads as neither). */
  growGroups(): void {
    for (const plane of this.run.planes) {
      const groups = [...plane.shapes.values()].filter((group) => group.kind === 'group');
      if (!groups.length) continue;
      for (const id of this.run.place.placed) {
        const shape = plane.shapes.get(id);
        if (!shape || !PlaneQuery.isLeaf(shape) || shape.kind === 'boundary') continue;
        for (const group of groups) {
          const box = group.bounds;
          if (!overlaps(shape.bounds, box) || inside(shape.bounds, box, 10)) continue;
          const pad = 15;
          const left = Math.min(box.x, shape.bounds.x - pad);
          const top = Math.min(box.y, shape.bounds.y - pad);
          group.bounds = { x: left, y: top, width: Math.max(right(box), right(shape.bounds) + pad) - left, height: Math.max(box.y + box.height, shape.bounds.y + shape.bounds.height + pad) - top };
          this.run.place.moved.add(group.id);
        }
      }
    }
  }
}
