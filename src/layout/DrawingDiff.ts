import type { Snapshot } from './Snapshot.js';
import type { IncrementalLayout, IncrementalOptions } from './IncrementalLayout.js';
import { LayoutDebug } from '../shared/LayoutDebug.js';
import { SIZES } from '../diagram/utils/sizes.js';
import { is, type El } from '../model/utils/moddle.js';
import { copyBox, cy, inside, overlaps, right, type Box } from '../diagram/utils/geom.js';
import { idOf } from '../diagram/utils/raw.js';
import { Frames } from '../diagram/Frames.js';
import { PlaneQuery } from '../diagram/PlaneQuery.js';
import type { DShape, Plane } from '../diagram/types.js';
import { PlaneCheckpoint } from '../diagram/PlaneCheckpoint.js';
import { Drawing } from '../diagram/Drawing.js';
import type { SpaceResult } from '../diagram/SpaceTool.js';

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
    return planeDi ? planes.find((p) => p.di === planeDi) : undefined;
  }

  /**
   * Prunes removed lanes and pools, and takes nodes that left their place in the flow, scope or
   * plane (and boundary events on another host) off the drawing to be placed again with their DI.
   * Returns the strips removed and relocated nodes leave.
   */
  removedAndRelocated(relocated: Set<string>): Strip[] {
    const strips: Strip[] = [];
    const live = new Set<El>();
    for (const p of this.run.planes) {
      for (const s of p.shapes.values()) if (s.di) live.add(s.di);
      for (const e of p.edges.values()) if (e.di) live.add(e.di);
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
      if (flowNode && !frameGone) strips.push({ plane, box: entry.bounds, ...(poolId ? { poolId } : {}), ...(parentId ? { parentId } : {}) });
    }
    for (const plane of this.run.planes) {
      for (const s of [...plane.shapes.values()]) {
        if (!is(s.el, 'bpmn:FlowNode')) continue;
        if (s.kind === 'boundary') {
          const hostBefore = this.run.cur(this.snap.hostOf.get(this.run.oldId(s)));
          if (!s.di || !this.snap.byDi.has(s.di) || hostBefore === undefined || hostBefore === s.hostId || !plane.shapes.has(s.id)) continue;
          // re-attached (`move --on`): placed again on the new host, its DI reused
          plane.shapes.delete(s.id);
          this.run.place.reuse.set(s.id, { shape: s, boundaries: [], from: plane });
          this.run.relocated.add(s.id);
          for (const e of plane.edges.values()) if (e.sourceId === s.id || e.targetId === s.id) this.run.reroute.add(e.id);
          continue;
        }
        // compared by the ids now: renaming a process or sub-process (`set id=`) relocates nothing
        const scopeNow = idOf(this.run.sem.scopeOf.get(s.id));
        const scopeBefore = this.run.cur(this.snap.scopeOf.get(this.run.oldId(s)));
        const home = this.run.sem.homePlane(this.run.planes, s.id);
        if (!relocated.has(s.id) && scopeNow === scopeBefore && (!home || home === plane)) continue;
        const boundaries = [...plane.shapes.values()].filter((b) => b.hostId === s.id);
        const content = s.kind === 'subProcess' && s.expanded ? PlaneQuery.contentOf(plane, s.id) : undefined;
        plane.shapes.delete(s.id);
        for (const b of boundaries) plane.shapes.delete(b.id);
        for (const c of content?.shapes ?? []) plane.shapes.delete(c.id);
        this.run.place.reuse.set(s.id, { shape: s, boundaries, from: plane, ...(content ? { content } : {}) });
        this.run.relocated.add(s.id);
        // the strip is in the frame the node had before the ops (it may have moved into another)
        const was = s.di ? this.snap.byDi.get(s.di) : undefined;
        const poolId = was ? this.run.cur(was.poolId) : s.poolId;
        const parentId = was ? this.run.cur(was.parentId) : s.parentId;
        strips.push({ plane, box: copyBox(s.bounds), ...(poolId ? { poolId } : {}), ...(parentId ? { parentId } : {}) });
        const own = new Set([s.id, ...boundaries.map((b) => b.id)]);
        const inner = new Set(content?.edges.map((e) => e.id) ?? []);
        for (const e of plane.edges.values()) {
          if (inner.has(e.id)) continue;
          if ((e.sourceId && own.has(e.sourceId)) || (e.targetId && own.has(e.targetId))) this.run.reroute.add(e.id);
        }
      }
    }
    return strips;
  }

  /** Closes each empty strip; when something in another row reaches into it, only its own row. */
  closeStrips(strips: Strip[], ignore: Set<string>): void {
    const sorted = [...strips].sort((a, b) => b.box.x - a.box.x);
    for (const st of sorted) {
      const sp = this.run.place.spacing.get(st.plane) ?? PlaneQuery.spacingOf(st.plane);
      const frame = st.parentId ? st.plane.shapes.get(st.parentId) : st.poolId ? st.plane.shapes.get(st.poolId) : undefined;
      const from = st.box.x - sp.gap;
      const to = right(st.box) + sp.gap;
      const band = frame?.bounds;
      // inside an expanded sub-process only its content closes up (it shrinks); the outside stays
      const sub = frame?.kind === 'subProcess' ? frame : undefined;
      const keep = sub ? new Set([...st.plane.shapes.values()].filter((s) => s !== sub && s.hostId !== sub.id && !Frames.within(st.plane, s, sub)).map((s) => s.id)) : undefined;
      // nothing to pull back: leave the frame as it is
      const beyond = [...st.plane.shapes.values()].some((s) => PlaneQuery.isLeaf(s) && s.bounds.x >= to && (!band || (cy(s.bounds) >= band.y && cy(s.bounds) <= band.y + band.height)) && !keep?.has(s.id));
      if (!beyond) continue;
      const r = this.run.drawing(st.plane).closeStrip({ axis: 'x', from, to, gap: sp.gap, ignore, ...(band ? { within: { ...band } } : {}), ...(keep ? { keep } : {}) }) ?? (sub ? undefined : this.closeRow(st.plane, st.box, frame, from, to, sp.gap, ignore));
      if (LayoutDebug.on()) LayoutDebug.log(`[strip] x ${Math.round(from)}..${Math.round(to)}${band ? ` in ${frame!.id}` : ''}: ${r ? `closed, moved ${[...r.moved].join(',')}` : 'kept'}`);
      if (r) r.moved.forEach((x) => this.run.place.moved.add(x));
    }
  }

  /**
   * The strip closes within the removed node's row only, unless a moved shape would come within
   * 10 px of one that stays, cross the border of a group or frame that stays, or stay connected
   * to a shape beyond the strip in the frame or to an artifact (then nothing moves).
   */
  private closeRow(plane: Plane, box: Box, frame: DShape | undefined, from: number, to: number, gap: number, ignore: ReadonlySet<string>): SpaceResult | undefined {
    const pad = 10;
    const fb = frame?.bounds;
    const row: Box = { x: fb ? fb.x : -1e7, y: box.y - pad, width: fb ? fb.width : 2e7, height: box.height + 2 * pad };
    const onRow = [...plane.shapes.values()].filter((s) => PlaneQuery.isLeaf(s) && s.bounds.y < row.y + row.height && s.bounds.y + s.bounds.height > row.y && (!fb || (s.bounds.x >= fb.x && s.bounds.x <= right(fb))));
    // the strip on this row ends where the next shape starts (its gap may be below the median)
    const end = Math.min(to, ...onRow.filter((s) => s.bounds.x >= right(box) - 1).map((s) => s.bounds.x));
    if (!onRow.some((s) => s.bounds.x >= end - 3)) return undefined;
    const saved = new PlaneCheckpoint(plane);
    const r = new Drawing(plane).closeStrip({ axis: 'x', from, to: end, gap, ignore, within: row });
    if (!r) return undefined;
    const leaves = [...plane.shapes.values()].filter(PlaneQuery.isLeaf);
    const before = (s: DShape): Box => saved.boundsOf(s);
    const moved = leaves.filter((m) => r.moved.has(m.id));
    const clash = moved.some((m) => leaves.some((o) => !r.moved.has(o.id) && o.id !== m.hostId && o.hostId !== m.id && overlaps(m.bounds, o.bounds, 10) && !overlaps(before(m), before(o), 10)));
    // a moved expanded sub-process must not come over a shape that stays (one of another row)
    const covers = [...plane.shapes.values()].some(
      (f) => f.container && f.kind === 'subProcess' && r.moved.has(f.id) && leaves.some((o) => !r.moved.has(o.id) && o.hostId !== f.id && overlaps(f.bounds, o.bounds, 10) && !overlaps(before(f), before(o), 10)),
    );
    // inside / across / outside a group or frame that stayed
    const relation = (b: Box, f: Box): number => (inside(b, f) ? 2 : overlaps(b, f) ? 1 : 0);
    const frames = [...plane.shapes.values()].filter((f) => (f.kind === 'group' || f.container) && !r.moved.has(f.id));
    const crossed = moved.some((m) => frames.some((f) => relation(m.bounds, f.bounds) !== relation(before(m), f.bounds)));
    // what a full close would have moved too (beyond the strip, in the frame), and artifacts
    const behind = (id: string): boolean => {
      const o = plane.shapes.get(id);
      if (!o) return false;
      const c = o.bounds.y + o.bounds.height / 2;
      return o.bounds.x >= end - 3 && (!fb || (c >= fb.y && c <= fb.y + fb.height));
    };
    const tethered = [...plane.edges.values()].some((e) => {
      if (!e.sourceId || !e.targetId || r.moved.has(e.sourceId) === r.moved.has(e.targetId)) return false;
      const stayed = r.moved.has(e.sourceId) ? e.targetId : e.sourceId;
      return e.kind === 'association' || e.kind === 'dataAssociation' || behind(stayed);
    });
    if (clash || covers || crossed || tethered || r.resized.size) {
      saved.restore();
      return undefined;
    }
    return r;
  }

  /**
   * A sub-process retyped to a task keeps its DI with isExpanded: it becomes task-sized on its row
   * and the freed strip closes.
   */
  private shrinkRetyped(plane: Plane, s: DShape): void {
    const old = s.di ? this.snap.byDi.get(s.di) : undefined;
    if (s.kind === 'subProcess' || !old?.expanded || !s.di) return;
    const before = copyBox(s.bounds);
    s.bounds = { x: before.x, y: Math.round(cy(before) - SIZES.task.height / 2), ...SIZES.task };
    s.di.set('isExpanded', undefined);
    s.container = false;
    this.run.drawing(plane).reseatBoundaries(s, before);
    this.run.active.add(s.id);
    const sp = this.run.place.spacing.get(plane) ?? PlaneQuery.spacingOf(plane);
    const band = s.poolId ? plane.shapes.get(s.poolId)?.bounds : undefined;
    const own = new Set([...plane.edges.values()].filter((e) => e.sourceId === s.id || e.targetId === s.id).map((e) => e.id));
    const r = this.run.drawing(plane).closeStrip({ axis: 'x', from: right(s.bounds), to: right(before) + sp.gap, gap: sp.gap, ignore: own, ...(band ? { within: { ...band } } : {}) });
    r?.moved.forEach((x) => this.run.place.moved.add(x));
    own.forEach((id) => this.run.reroute.add(id));
  }

  /** Sub-processes whose requested expansion differs from their drawing collapse / expand. */
  applyExpansion(opts: IncrementalOptions): void {
    const want = new Map<string, boolean>();
    for (const id of opts.expand ?? []) want.set(id, true);
    for (const id of opts.collapse ?? []) want.set(id, false);
    for (const plane of [...this.run.planes]) {
      for (const s of [...plane.shapes.values()]) {
        if (s.kind !== 'subProcess') {
          this.shrinkRetyped(plane, s);
          continue;
        }
        const desired = want.get(s.id);
        if (desired === undefined || desired === (s.expanded === true)) continue;
        const sp = this.run.place.spacing.get(plane) ?? PlaneQuery.spacingOf(plane);
        if (!desired) {
          let child = this.run.planes.find((p) => p.rootId === s.id);
          if (!child) {
            child = { id: `BPMNPlane_${s.id}`, rootId: s.id, root: s.el, shapes: new Map(), edges: new Map(), dropped: [] };
            this.run.planes.push(child);
          }
          this.run.drawing(plane).collapse(s, child, sp.gap);
        } else {
          this.run.drawing(plane).expand(s, this.run.planes.find((p) => p.rootId === s.id), this.run.sem);
        }
        this.run.active.add(s.id);
        for (const e of plane.edges.values()) if (e.sourceId === s.id || e.targetId === s.id) this.run.reroute.add(e.id);
        this.run.notes.push(`${s.id} drawn ${desired ? 'expanded' : 'collapsed'}`);
      }
    }
  }

  /** Nodes whose lane changed move into the new lane band (same x). */
  laneChanges(): void {
    for (const plane of this.run.planes) {
      for (const s of [...plane.shapes.values()]) {
        if (!is(s.el, 'bpmn:FlowNode') || s.kind === 'boundary' || this.run.place.placed.has(s.id)) continue;
        const now = this.run.sem.laneOf.get(s.id);
        if (now === this.run.cur(this.snap.laneOf.get(this.run.oldId(s))) || !now) continue;
        if (this.run.place.changeLane(plane, s.id)) this.run.active.add(s.id);
      }
    }
  }
}
