import { SIZES } from '../../drawing/utils/sizes.js';
import { bottom, type Box, copyBox, cx, cy, median, right, union } from '../../drawing/utils/geom.js';
import { PlaneQuery } from '../../drawing/PlaneQuery.js';
import type { DEdge, DShape, Plane } from '../../drawing/types.js';
import type { Semantics } from '../../drawing/Semantics.js';

import type { SpaceResult, SpaceTool } from './SpaceTool.js';

const HEADER = 30;
const PAD = 30;

/**
 * Pools, lanes and sub-process expansion in a kept drawing.
 * Every method adds the ids it moved or resized to `touched`.
 */
export class FrameEditor {
  constructor(
    private readonly plane: Plane,
    private readonly space: SpaceTool,
    private readonly touched: Set<string>,
  ) {}

  private record(r: SpaceResult | undefined): void {
    if (!r) return;
    r.moved.forEach((x) => this.touched.add(x));
    r.resized.forEach((x) => this.touched.add(x));
  }

  private pools(): DShape[] {
    return [...this.plane.shapes.values()].filter((s) => s.kind === 'participant');
  }

  /** The first pool around a process diagram encloses all existing content. */
  wrapPool(pool: DShape): void {
    let box: Box | undefined;
    for (const s of this.plane.shapes.values()) {
      if (s === pool) continue;
      const parts = [s.bounds, ...(s.label ? [s.label] : [])];
      for (const b of parts) box = box ? union(box, b) : copyBox(b);
    }
    for (const e of this.plane.edges.values()) for (const p of e.points) box = box ? union(box, { x: p.x, y: p.y, width: 0, height: 0 }) : { x: p.x, y: p.y, width: 0, height: 0 };
    pool.bounds = box ? { x: Math.round(box.x - HEADER - PAD), y: Math.round(box.y - PAD), width: Math.round(box.width + HEADER + 2 * PAD), height: Math.round(box.height + 2 * PAD) } : { x: 100, y: 80, width: 600, height: 250 };
  }

  /** Below the last pool and as wide as the widest. */
  placePool(pool: DShape, blackBox: boolean, size?: { width: number; height: number }): void {
    const others = this.pools().filter((p) => p !== pool);
    const height = size?.height ?? (blackBox ? SIZES.blackBoxHeight : 200);
    if (!others.length) {
      let content: Box | undefined;
      for (const s of this.plane.shapes.values()) if (s !== pool) content = content ? union(content, s.bounds) : copyBox(s.bounds);
      const x = content ? content.x - HEADER - PAD : 100;
      const y = content ? bottom(content) + 80 : 80;
      pool.bounds = { x: Math.round(x), y: Math.round(y), width: Math.round(size?.width ?? Math.max(600, content ? content.width + HEADER + 2 * PAD : 600)), height };
      return;
    }
    const sorted = [...others].sort((a, b) => a.bounds.y - b.bounds.y);
    const gaps: number[] = [];
    for (let i = 0; i + 1 < sorted.length; i++) gaps.push(sorted[i + 1]!.bounds.y - bottom(sorted[i]!.bounds));
    const gap = Math.max(0, Math.round(median(gaps.filter((g) => g >= 0)) ?? 80));
    const widest = [...others].sort((a, b) => b.bounds.width - a.bounds.width || a.bounds.x - b.bounds.x)[0]!;
    const lowest = Math.max(...others.map((p) => bottom(p.bounds)));
    pool.bounds = { x: widest.bounds.x, y: Math.round(lowest + gap), width: Math.max(widest.bounds.width, size?.width ?? 0), height };
  }

  private siblingLanes(poolId: string | undefined, parentId: string | undefined, except: string): DShape[] {
    return [...this.plane.shapes.values()].filter((s) => s.kind === 'lane' && s.id !== except && s.poolId === poolId && s.laneId === parentId).sort((a, b) => a.bounds.y - b.bounds.y);
  }

  private containerChain(c: DShape): DShape[] {
    const out: DShape[] = [];
    let cur: DShape | undefined = c;
    for (let i = 0; cur && i < 10; i++) {
      out.push(cur);
      cur = cur.kind === 'lane' ? (cur.laneId ? this.plane.shapes.get(cur.laneId) : cur.poolId ? this.plane.shapes.get(cur.poolId) : undefined) : undefined;
    }
    return out;
  }

  /**
   * The first lane takes the whole band; further lanes are appended at the bottom and the frames
   * around grow. False when its pool is not drawn.
   */
  placeLane(lane: DShape): boolean {
    const container = lane.laneId ? this.plane.shapes.get(lane.laneId) : lane.poolId ? this.plane.shapes.get(lane.poolId) : undefined;
    if (!container) return false;
    const siblings = this.siblingLanes(lane.poolId, lane.laneId, lane.id);
    const cb = container.bounds;
    if (!siblings.length) {
      lane.bounds = { x: cb.x + HEADER, y: cb.y, width: cb.width - HEADER, height: cb.height };
      return true;
    }
    const height = Math.round(median(siblings.map((s) => s.bounds.height)) ?? 150) || 150;
    const line = bottom(cb);
    const chain = this.containerChain(container);
    const before = new Map(chain.map((c) => [c.id, bottom(c.bounds)]));
    const band = lane.poolId ? this.plane.shapes.get(lane.poolId)?.bounds : undefined;
    this.record(this.space.makeSpace({ axis: 'y', line, delta: height, ...(band ? { within: { ...band } } : {}) }));
    for (const c of chain) {
      if (Math.abs(before.get(c.id)! - line) <= 1 && bottom(c.bounds) < line + height - 0.5) {
        c.bounds.height += height;
        this.touched.add(c.id);
      }
    }
    const ref = siblings[siblings.length - 1]!;
    lane.bounds = { x: ref.bounds.x, y: line, width: ref.bounds.width, height };
    return true;
  }

  /** Closes the lane's band when empty, else lets a sibling take it over. */
  removedLane(box: Box, poolId: string | undefined, parentId: string | undefined): void {
    const pool = poolId ? this.plane.shapes.get(poolId) : undefined;
    const occupied = [...this.plane.shapes.values()].some((s) => PlaneQuery.isLeaf(s) && s.kind !== 'boundary' && cy(s.bounds) > box.y && cy(s.bounds) < bottom(box) && (!pool || (s.bounds.x >= pool.bounds.x && s.bounds.x <= right(pool.bounds))));
    const siblings = this.siblingLanes(poolId, parentId, '');
    // the only lane: its band is the whole frame, which keeps its size (audit #39)
    if (!siblings.length) return;
    if (!occupied) {
      this.record(this.space.makeSpace({ axis: 'y', line: bottom(box) - 0.5, delta: -box.height, ...(pool ? { within: { ...pool.bounds } } : {}) }));
      return;
    }
    const above = siblings.find((s) => Math.abs(bottom(s.bounds) - box.y) <= 1);
    const below = siblings.find((s) => Math.abs(s.bounds.y - bottom(box)) <= 1);
    if (above) {
      above.bounds.height += box.height;
      this.touched.add(above.id);
    } else if (below) {
      below.bounds.y -= box.height;
      below.bounds.height += box.height;
      this.touched.add(below.id);
    }
  }

  removedPool(box: Box): void {
    const below = this.pools().filter((p) => p.bounds.y >= bottom(box) - 1);
    if (!below.length) return;
    const next = Math.min(...below.map((p) => p.bounds.y));
    const occupied = [...this.plane.shapes.values()].some((s) => s.kind !== 'participant' && cy(s.bounds) > box.y && cy(s.bounds) < next);
    if (occupied) return;
    this.record(this.space.makeSpace({ axis: 'y', line: next - 0.5, delta: -(next - box.y) }));
  }

  private shiftAll(shapes: DShape[], edges: DEdge[], dx: number, dy: number): void {
    for (const s of shapes) {
      s.bounds.x += dx;
      s.bounds.y += dy;
      if (s.label) {
        s.label.x += dx;
        s.label.y += dy;
      }
    }
    for (const e of edges) {
      for (const p of e.points) {
        p.x += dx;
        p.y += dy;
      }
      if (e.label) {
        e.label.x += dx;
        e.label.y += dy;
      }
    }
  }

  /**
   * Puts boundary events back on a resized host's border: same side and distance from the far
   * corner when that fits, else spread in their old order, overflow to the opposite side.
   */
  reseatBoundaries(host: DShape, old: Box): void {
    const events = PlaneQuery.boundariesOf(this.plane, host.id);
    if (!events.length) return;
    const nb = host.bounds;
    type Side = 'top' | 'bottom' | 'left' | 'right';
    const sideOf = (b: Box): Side => {
      const c = { x: cx(b), y: cy(b) };
      const d: Array<[Side, number]> = [
        ['bottom', Math.abs(c.y - bottom(old))],
        ['right', Math.abs(c.x - right(old))],
        ['top', Math.abs(c.y - old.y)],
        ['left', Math.abs(c.x - old.x)],
      ];
      return d.reduce((a, b2) => (b2[1] < a[1] ? b2 : a))[0];
    };
    const horizontal = (side: Side): boolean => side === 'top' || side === 'bottom';
    const opposite: Record<Side, Side> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };
    const along = (b: Box, side: Side): number => (horizontal(side) ? cx(b) : cy(b));
    const span = (box: Box, side: Side): [number, number] => (horizontal(side) ? [box.x, right(box)] : [box.y, bottom(box)]);
    const bySide = new Map<Side, DShape[]>();
    for (const e of events) {
      const side = sideOf(e.bounds);
      bySide.set(side, [...(bySide.get(side) ?? []), e]);
    }
    const placed = new Map<DShape, { side: Side; c: number }>();
    const overflow: Array<[Side, DShape]> = [];
    const fit = (side: Side, list: DShape[], keepOffsets: boolean): void => {
      const sorted = [...list].sort((a, b) => along(a.bounds, side) - along(b.bounds, side));
      const [lo, hi] = span(nb, side);
      const size = (e: DShape): number => (horizontal(side) ? e.bounds.width : e.bounds.height);
      const taken = [...placed.entries()].filter(([, p]) => p.side === side);
      const free = (c: number, e: DShape): boolean => c - size(e) / 2 >= lo - 0.5 && c + size(e) / 2 <= hi + 0.5 && taken.every(([o, p]) => Math.abs(p.c - c) >= (size(o) + size(e)) / 2 + 4);
      if (keepOffsets) {
        const [, oldHi] = span(old, side);
        const cs = sorted.map((e) => hi - (oldHi - along(e.bounds, side)));
        const ok = sorted.every((e, i) => free(cs[i]!, e) && sorted.every((o, j) => j === i || Math.abs(cs[j]! - cs[i]!) >= (size(o) + size(e)) / 2 + 4));
        if (ok) {
          sorted.forEach((e, i) => placed.set(e, { side, c: cs[i]! }));
          return;
        }
      }
      let c = hi;
      for (const e of [...sorted].reverse()) {
        c = Math.min(c - size(e) / 2 - 7, hi - size(e) / 2 - 7);
        while (!free(c, e) && c - size(e) / 2 >= lo) c -= 4;
        if (free(c, e)) {
          placed.set(e, { side, c });
          taken.push([e, { side, c }]);
          c -= size(e) / 2;
        } else overflow.push([side, e]);
      }
    };
    for (const [side, list] of bySide) fit(side, list, true);
    for (const [side, e] of overflow.splice(0)) fit(opposite[side], [e], false);
    for (const [side, e] of overflow) placed.set(e, { side, c: span(nb, side)[1] - (horizontal(side) ? e.bounds.width : e.bounds.height) / 2 });
    for (const [e, { side, c }] of placed) {
      const w = e.bounds.width;
      const h = e.bounds.height;
      const cx = horizontal(side) ? c : side === 'left' ? nb.x : right(nb);
      const cyv = horizontal(side) ? (side === 'top' ? nb.y : bottom(nb)) : c;
      const dx = Math.round(cx - w / 2) - e.bounds.x;
      const dy = Math.round(cyv - h / 2) - e.bounds.y;
      if (!dx && !dy) continue;
      e.bounds.x += dx;
      e.bounds.y += dy;
      if (e.label) {
        e.label.x += dx;
        e.label.y += dy;
      }
      this.touched.add(e.id);
    }
  }

  /** The content moves to `child`, keeping relative positions. */
  collapse(sub: DShape, child: Plane, gap: number): void {
    const { shapes, edges } = PlaneQuery.contentOf(this.plane, sub.id);
    const old = copyBox(sub.bounds);
    this.shiftAll(shapes, edges, 160 - (old.x + PAD), 80 - (old.y + 45));
    for (const s of shapes) {
      this.plane.shapes.delete(s.id);
      if (s.parentId === sub.id) delete s.parentId;
      child.shapes.set(s.id, s);
    }
    for (const e of edges) {
      this.plane.edges.delete(e.id);
      child.edges.set(e.id, e);
    }
    const size = SIZES.task;
    sub.bounds = { x: old.x, y: Math.round(cy(old) - size.height / 2), width: size.width, height: size.height };
    sub.expanded = false;
    sub.container = false;
    this.touched.add(sub.id);
    this.reseatBoundaries(sub, old);
    const band = sub.poolId ? this.plane.shapes.get(sub.poolId)?.bounds : undefined;
    this.record(this.space.closeStrip({ axis: 'x', from: right(sub.bounds), to: right(old) + gap, gap, ...(band ? { within: { ...band } } : {}) }));
  }

  /** The content of `child` moves in and the space tool makes room. */
  expand(sub: DShape, child: Plane | undefined, sem: Semantics): void {
    const content = child ? [...child.shapes.values()] : [];
    let box: Box | undefined;
    for (const s of content) {
      for (const b of [s.bounds, ...(s.label ? [s.label] : [])]) box = box ? union(box, b) : copyBox(b);
    }
    const width = Math.max(350, box ? Math.round(box.width + 2 * PAD) : 0);
    const height = Math.max(200, box ? Math.round(box.height + 45 + PAD) : 0);
    const old = copyBox(sub.bounds);
    // a frame from now on, so the space tool never grows it over foreign shapes
    sub.expanded = true;
    sub.container = true;
    const keep = new Set(PlaneQuery.boundariesOf(this.plane, sub.id).map((b) => b.id));
    const grow = (axis: 'x' | 'y', delta: number): void => {
      if (delta <= 0) return;
      const line = axis === 'x' ? right(sub.bounds) - 0.5 : bottom(sub.bounds) - 0.5;
      this.record(this.space.makeSpace({ axis, line, delta, keep, anchors: [sub.id], frame: sub.id }));
    };
    grow('x', width - old.width);
    grow('y', height - old.height);
    sub.bounds = { x: old.x, y: old.y, width, height };
    this.touched.add(sub.id);
    this.reseatBoundaries(sub, old);
    if (!child) return;
    const edges = [...child.edges.values()];
    if (box) this.shiftAll(content, edges, sub.bounds.x + PAD - box.x, sub.bounds.y + 45 - box.y);
    for (const s of content) {
      child.shapes.delete(s.id);
      const scope = sem.scopeOf.get(s.id);
      if (scope && (scope as { id?: string }).id === sub.id) s.parentId = sub.id;
      if (s.poolId === undefined && sub.poolId) s.poolId = sub.poolId;
      this.plane.shapes.set(s.id, s);
    }
    for (const e of edges) {
      child.edges.delete(e.id);
      this.plane.edges.set(e.id, e);
    }
    child.deleted = true;
  }
}
