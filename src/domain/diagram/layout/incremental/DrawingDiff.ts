import type { Snapshot } from './Snapshot.js';
import type { IncrementalLayout, IncrementalOptions } from './IncrementalLayout.js';
import { LayoutDebug } from '../LayoutDebug.js';
import { SIZES } from '../../utils/sizes.js';
import { is, type El } from '../../../document/utils/moddle.js';
import { type Box, copyBox, cy, inside, overlaps, right } from '../../utils/geom.js';
import { idOf } from '../../utils/raw.js';
import { Frames } from '../../di/Frames.js';
import { PlaneQuery } from '../../di/PlaneQuery.js';
import type { DShape, Plane } from '../../di/types.js';
import { DrawingCheckpoint } from '../../di/DrawingCheckpoint.js';
import { Drawing } from './Drawing.js';
import type { SpaceResult } from './SpaceTool.js';

interface Strip {
  plane: Plane;
  box: Box;
  poolId?: string;
  parentId?: string;
}

/**
 * What the ops changed in the kept drawing before anything new is placed: removed and relocated
 * nodes give their strip back, sub-processes change expansion or shrink to a task, nodes move
 * into their new lane.
 */
export class DrawingDiff {
  constructor(
    private readonly run: IncrementalLayout,
    private readonly snap: Snapshot,
  ) {}

  private planeOfDi(planes: readonly Plane[], planeDi: El | undefined): Plane | undefined {
    return planeDi ? planes.find((plane) => plane.di === planeDi) : undefined;
  }

  /**
   * Prunes removed lanes and pools, and takes nodes that left their place in the flow, scope or
   * plane (and boundary events on another host) off the drawing to be placed again with their DI.
   * Returns the strips removed and relocated nodes leave.
   * A re-attached boundary event (`move --on`) is placed again on the new host. Scopes are compared
   * by their ids now, so renaming a process or sub-process (`set id=`) relocates nothing; a strip
   * lies in the frame the node had before the ops.
   */
  removedAndRelocated(relocated: Set<string>): Strip[] {
    const strips: Strip[] = [];
    const live = new Set<El>();
    for (const plane of this.run.planes) {
      for (const shape of plane.shapes.values()) {
        if (shape.di) live.add(shape.di);
      }
      for (const edge of plane.edges.values()) {
        if (edge.di) live.add(edge.di);
      }
    }
    for (const [di, entry] of this.snap.byDi) {
      if (live.has(di) || !entry.bounds) continue;
      const plane = this.planeOfDi(this.run.planes, entry.planeDi);
      if (!plane) continue;
      if (entry.kind === 'lane') {
        this.run.drawing(plane).removedLane(entry.bounds, entry.poolId, entry.laneId);
        continue;
      }
      if (entry.kind === 'participant') {
        this.run.drawing(plane).removedPool(entry.bounds);
        continue;
      }
      const flowNode = ['task', 'subProcess', 'event', 'gateway'].includes(entry.kind);
      const poolId = this.run.cur(entry.poolId);
      const parentId = this.run.cur(entry.parentId);
      const frameGone = (poolId && !plane.shapes.has(poolId)) || (parentId && !plane.shapes.has(parentId));
      if (flowNode && !frameGone) {
        strips.push({ plane, box: entry.bounds, ...(poolId ? { poolId } : {}), ...(parentId ? { parentId } : {}) });
      }
    }
    for (const plane of this.run.planes) {
      for (const shape of [...plane.shapes.values()]) {
        if (!is(shape.el, 'bpmn:FlowNode')) continue;
        if (shape.kind === 'boundary') {
          const hostBefore = this.run.cur(this.snap.hostOf.get(this.run.oldId(shape)));
          if (!shape.di || !this.snap.byDi.has(shape.di) || hostBefore === undefined || hostBefore === shape.hostId || !plane.shapes.has(shape.id)) {
            continue;
          }
          plane.shapes.delete(shape.id);
          this.run.place.reuse.set(shape.id, { shape, boundaries: [], from: plane });
          this.run.relocated.add(shape.id);
          for (const edge of plane.edges.values()) {
            if (edge.sourceId === shape.id || edge.targetId === shape.id) {
              this.run.reroute.add(edge.id);
            }
          }
          continue;
        }
        const scopeNow = idOf(this.run.sem.scopeOf.get(shape.id));
        const scopeBefore = this.run.cur(this.snap.scopeOf.get(this.run.oldId(shape)));
        const home = this.run.sem.homePlane(this.run.planes, shape.id);
        if (!relocated.has(shape.id) && scopeNow === scopeBefore && (!home || home === plane)) {
          continue;
        }
        const boundaries = [...plane.shapes.values()].filter((boundary) => boundary.hostId === shape.id);
        const content = shape.kind === 'subProcess' && shape.expanded ? PlaneQuery.contentOf(plane, shape.id) : undefined;
        plane.shapes.delete(shape.id);
        for (const boundary of boundaries) {
          plane.shapes.delete(boundary.id);
        }
        for (const contentShape of content?.shapes ?? []) {
          plane.shapes.delete(contentShape.id);
        }
        this.run.place.reuse.set(shape.id, { shape, boundaries, from: plane, ...(content ? { content } : {}) });
        this.run.relocated.add(shape.id);
        const was = shape.di ? this.snap.byDi.get(shape.di) : undefined;
        const poolId = was ? this.run.cur(was.poolId) : shape.poolId;
        const parentId = was ? this.run.cur(was.parentId) : shape.parentId;
        strips.push({ plane, box: copyBox(shape.bounds), ...(poolId ? { poolId } : {}), ...(parentId ? { parentId } : {}) });
        const own = new Set([shape.id, ...boundaries.map((boundary) => boundary.id)]);
        const inner = new Set(content?.edges.map((edge) => edge.id) ?? []);
        for (const edge of plane.edges.values()) {
          if (inner.has(edge.id)) continue;
          if ((edge.sourceId && own.has(edge.sourceId)) || (edge.targetId && own.has(edge.targetId))) {
            this.run.reroute.add(edge.id);
          }
        }
      }
    }
    return strips;
  }

  /**
   * Closes each empty strip; when something in another row reaches into it, only its own row.
   * Inside an expanded sub-process only its content closes up (it shrinks) and the outside stays;
   * with nothing to pull back the frame stays as it is.
   */
  closeStrips(strips: Strip[], ignore: Set<string>): void {
    const sorted = [...strips].sort((leftStrip, rightStrip) => rightStrip.box.x - leftStrip.box.x);
    for (const st of sorted) {
      const sp = this.run.place.spacing.get(st.plane) ?? PlaneQuery.spacingOf(st.plane);
      const frame = st.parentId ? st.plane.shapes.get(st.parentId) : st.poolId ? st.plane.shapes.get(st.poolId) : undefined;
      const from = st.box.x - sp.gap;
      const to = right(st.box) + sp.gap;
      const band = frame?.bounds;
      const sub = frame?.kind === 'subProcess' ? frame : undefined;
      const keep = sub ? new Set([...st.plane.shapes.values()].filter((shape) => shape !== sub && shape.hostId !== sub.id && !Frames.within(st.plane, shape, sub)).map((shape) => shape.id)) : undefined;
      const beyond = [...st.plane.shapes.values()].some((shape) => PlaneQuery.isLeaf(shape) && shape.bounds.x >= to && (!band || (cy(shape.bounds) >= band.y && cy(shape.bounds) <= band.y + band.height)) && !keep?.has(shape.id));
      if (!beyond) continue;
      const result = this.run.drawing(st.plane).closeStrip({ axis: 'x', from, to, gap: sp.gap, ignore, ...(band ? { within: { ...band } } : {}), ...(keep ? { keep } : {}) }) ?? (sub ? undefined : this.closeRow(st.plane, st.box, frame, from, to, sp.gap, ignore));
      if (LayoutDebug.on()) {
        LayoutDebug.log(`[strip] x ${Math.round(from)}..${Math.round(to)}${band ? ` in ${frame!.id}` : ''}: ${result ? `closed, moved ${[...result.moved].join(',')}` : 'kept'}`);
      }
      if (result) {
        result.moved.forEach((movedId) => this.run.place.moved.add(movedId));
      }
    }
  }

  /**
   * The strip closes within the removed node's row only, unless a moved shape would come within
   * 10 px of one that stays, cross the border of a group or frame that stays, or stay connected
   * to a shape beyond the strip in the frame or to an artifact (then nothing moves).
   * The strip on the row ends where the next shape starts (its gap may be below the median), and a
   * moved expanded sub-process must not come over a shape of another row either.
   */
  private closeRow(plane: Plane, box: Box, frame: DShape | undefined, from: number, to: number, gap: number, ignore: ReadonlySet<string>): SpaceResult | undefined {
    const pad = 10;
    const fb = frame?.bounds;
    const row: Box = { x: fb ? fb.x : -1e7, y: box.y - pad, width: fb ? fb.width : 2e7, height: box.height + 2 * pad };
    const onRow = [...plane.shapes.values()].filter((shape) => PlaneQuery.isLeaf(shape) && shape.bounds.y < row.y + row.height && shape.bounds.y + shape.bounds.height > row.y && (!fb || (shape.bounds.x >= fb.x && shape.bounds.x <= right(fb))));
    const end = Math.min(to, ...onRow.filter((shape) => shape.bounds.x >= right(box) - 1).map((shape) => shape.bounds.x));
    if (!onRow.some((shape) => shape.bounds.x >= end - 3)) return undefined;
    const saved = new DrawingCheckpoint(plane);
    const result = new Drawing(plane).closeStrip({ axis: 'x', from, to: end, gap, ignore, within: row });
    if (!result) return undefined;
    const leaves = [...plane.shapes.values()].filter(PlaneQuery.isLeaf);
    const before = (shape: DShape): Box => saved.boundsOf(shape);
    const moved = leaves.filter((leaf) => result.moved.has(leaf.id));
    const clash = moved.some((movedLeaf) => leaves.some((otherLeaf) => !result.moved.has(otherLeaf.id) && otherLeaf.id !== movedLeaf.hostId && otherLeaf.hostId !== movedLeaf.id && overlaps(movedLeaf.bounds, otherLeaf.bounds, 10) && !overlaps(before(movedLeaf), before(otherLeaf), 10)));
    const covers = [...plane.shapes.values()].some(
      (frame) => frame.container && frame.kind === 'subProcess' && result.moved.has(frame.id) && leaves.some((otherLeaf) => !result.moved.has(otherLeaf.id) && otherLeaf.hostId !== frame.id && overlaps(frame.bounds, otherLeaf.bounds, 10) && !overlaps(before(frame), before(otherLeaf), 10)),
    );
    const relation = (box: Box, frameBox: Box): number => (inside(box, frameBox) ? 2 : overlaps(box, frameBox) ? 1 : 0);
    const frames = [...plane.shapes.values()].filter((frame) => (frame.kind === 'group' || frame.container) && !result.moved.has(frame.id));
    const crossed = moved.some((movedLeaf) => frames.some((frame) => relation(movedLeaf.bounds, frame.bounds) !== relation(before(movedLeaf), frame.bounds)));
    const behind = (id: string): boolean => {
      const other = plane.shapes.get(id);
      if (!other) return false;
      const centerY = cy(other.bounds);
      return other.bounds.x >= end - 3 && (!fb || (centerY >= fb.y && centerY <= fb.y + fb.height));
    };
    const tethered = [...plane.edges.values()].some((edge) => {
      if (!edge.sourceId || !edge.targetId || result.moved.has(edge.sourceId) === result.moved.has(edge.targetId)) {
        return false;
      }
      const stayed = result.moved.has(edge.sourceId) ? edge.targetId : edge.sourceId;
      return edge.kind === 'association' || edge.kind === 'dataAssociation' || behind(stayed);
    });
    if (clash || covers || crossed || tethered || result.resized.size) {
      saved.restore();
      return undefined;
    }
    return result;
  }

  /**
   * A sub-process retyped to a task keeps its DI with isExpanded: it becomes task-sized on its row
   * and the freed strip closes.
   */
  private shrinkRetyped(plane: Plane, shape: DShape): void {
    const old = shape.di ? this.snap.byDi.get(shape.di) : undefined;
    if (shape.kind === 'subProcess' || !old?.expanded || !shape.di) return;
    const before = copyBox(shape.bounds);
    shape.bounds = { x: before.x, y: Math.round(cy(before) - SIZES.task.height / 2), ...SIZES.task };
    shape.di.set('isExpanded', undefined);
    shape.container = false;
    this.run.drawing(plane).reseatBoundaries(shape, before);
    this.run.active.add(shape.id);
    const sp = this.run.place.spacing.get(plane) ?? PlaneQuery.spacingOf(plane);
    const band = shape.poolId ? plane.shapes.get(shape.poolId)?.bounds : undefined;
    const own = new Set([...plane.edges.values()].filter((edge) => edge.sourceId === shape.id || edge.targetId === shape.id).map((edge) => edge.id));
    const result = this.run.drawing(plane).closeStrip({ axis: 'x', from: right(shape.bounds), to: right(before) + sp.gap, gap: sp.gap, ignore: own, ...(band ? { within: { ...band } } : {}) });
    result?.moved.forEach((movedId) => this.run.place.moved.add(movedId));
    own.forEach((id) => this.run.reroute.add(id));
  }

  /** Sub-processes whose requested expansion differs from their drawing collapse / expand. */
  applyExpansion(opts: IncrementalOptions): void {
    const want = new Map<string, boolean>();
    for (const id of opts.expand ?? []) {
      want.set(id, true);
    }
    for (const id of opts.collapse ?? []) {
      want.set(id, false);
    }
    for (const plane of [...this.run.planes]) {
      for (const shape of [...plane.shapes.values()]) {
        if (shape.kind !== 'subProcess') {
          this.shrinkRetyped(plane, shape);
          continue;
        }
        const desired = want.get(shape.id);
        if (desired === undefined || desired === (shape.expanded === true)) continue;
        const sp = this.run.place.spacing.get(plane) ?? PlaneQuery.spacingOf(plane);
        if (!desired) {
          let child = this.run.planes.find((plane) => plane.rootId === shape.id);
          if (!child) {
            child = { id: `BPMNPlane_${shape.id}`, rootId: shape.id, root: shape.el, shapes: new Map(), edges: new Map(), dropped: [] };
            this.run.planes.push(child);
          }
          this.run.drawing(plane).collapse(shape, child, sp.gap);
        } else {
          this.run.drawing(plane).expand(shape, this.run.planes.find((plane) => plane.rootId === shape.id), this.run.sem);
        }
        this.run.active.add(shape.id);
        for (const edge of plane.edges.values()) {
          if (edge.sourceId === shape.id || edge.targetId === shape.id) {
            this.run.reroute.add(edge.id);
          }
        }
        this.run.notes.push(`${shape.id} drawn ${desired ? 'expanded' : 'collapsed'}`);
      }
    }
  }

  /** Nodes whose lane changed move into the new lane band (same x). */
  laneChanges(): void {
    for (const plane of this.run.planes) {
      for (const shape of [...plane.shapes.values()]) {
        if (!is(shape.el, 'bpmn:FlowNode') || shape.kind === 'boundary' || this.run.place.placed.has(shape.id)) {
          continue;
        }
        const now = this.run.sem.laneOf.get(shape.id);
        if (now === this.run.cur(this.snap.laneOf.get(this.run.oldId(shape))) || !now) {
          continue;
        }
        if (this.run.place.changeLane(plane, shape.id)) this.run.active.add(shape.id);
      }
    }
  }
}
