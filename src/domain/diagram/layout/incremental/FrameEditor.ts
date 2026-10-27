import { SIZES } from '../../utils/sizes.js';
import { bottom, type Box, copyBox, cx, cy, median, right, translateEdge, translateShape, union } from '../../utils/geom.js';
import { PlaneQuery } from '../../di/PlaneQuery.js';
import type { DEdge, DShape, Plane } from '../../di/types.js';
import type { Semantics } from '../../di/Semantics.js';

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

  private record(result: SpaceResult | undefined): void {
    if (!result) return;
    result.moved.forEach((id) => this.touched.add(id));
    result.resized.forEach((id) => this.touched.add(id));
  }

  private pools(): DShape[] {
    return [...this.plane.shapes.values()].filter((shape) => shape.kind === 'participant');
  }

  /** The first pool around a process diagram encloses all existing content. */
  wrapPool(pool: DShape): void {
    let box: Box | undefined;
    for (const shape of this.plane.shapes.values()) {
      if (shape === pool) continue;
      const parts = [shape.bounds, ...(shape.label ? [shape.label] : [])];
      for (const part of parts) box = box ? union(box, part) : copyBox(part);
    }
    for (const edge of this.plane.edges.values()) for (const point of edge.points) box = box ? union(box, { x: point.x, y: point.y, width: 0, height: 0 }) : { x: point.x, y: point.y, width: 0, height: 0 };
    pool.bounds = box ? { x: Math.round(box.x - HEADER - PAD), y: Math.round(box.y - PAD), width: Math.round(box.width + HEADER + 2 * PAD), height: Math.round(box.height + 2 * PAD) } : { x: 100, y: 80, width: 600, height: 250 };
  }

  /** Below the last pool and as wide as the widest. */
  placePool(pool: DShape, blackBox: boolean, size?: { width: number; height: number }): void {
    const others = this.pools().filter((existing) => existing !== pool);
    const height = size?.height ?? (blackBox ? SIZES.blackBoxHeight : 200);
    if (!others.length) {
      let content: Box | undefined;
      for (const shape of this.plane.shapes.values()) if (shape !== pool) content = content ? union(content, shape.bounds) : copyBox(shape.bounds);
      const left = content ? content.x - HEADER - PAD : 100;
      const top = content ? bottom(content) + 80 : 80;
      pool.bounds = { x: Math.round(left), y: Math.round(top), width: Math.round(size?.width ?? Math.max(600, content ? content.width + HEADER + 2 * PAD : 600)), height };
      return;
    }
    const sorted = [...others].sort((upper, lower) => upper.bounds.y - lower.bounds.y);
    const gaps: number[] = [];
    for (let index = 0; index + 1 < sorted.length; index++) gaps.push(sorted[index + 1]!.bounds.y - bottom(sorted[index]!.bounds));
    const gap = Math.max(0, Math.round(median(gaps.filter((spacing) => spacing >= 0)) ?? 80));
    const widest = [...others].sort((first, second) => second.bounds.width - first.bounds.width || first.bounds.x - second.bounds.x)[0]!;
    const lowest = Math.max(...others.map((existing) => bottom(existing.bounds)));
    pool.bounds = { x: widest.bounds.x, y: Math.round(lowest + gap), width: Math.max(widest.bounds.width, size?.width ?? 0), height };
  }

  private siblingLanes(poolId: string | undefined, parentId: string | undefined, except: string): DShape[] {
    return [...this.plane.shapes.values()].filter((shape) => shape.kind === 'lane' && shape.id !== except && shape.poolId === poolId && shape.laneId === parentId).sort((upper, lower) => upper.bounds.y - lower.bounds.y);
  }

  private containerChain(container: DShape): DShape[] {
    const out: DShape[] = [];
    let cur: DShape | undefined = container;
    for (let depth = 0; cur && depth < 10; depth++) {
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
    const height = Math.round(median(siblings.map((sibling) => sibling.bounds.height)) ?? 150) || 150;
    const line = bottom(cb);
    const chain = this.containerChain(container);
    const before = new Map(chain.map((frame) => [frame.id, bottom(frame.bounds)]));
    const band = lane.poolId ? this.plane.shapes.get(lane.poolId)?.bounds : undefined;
    this.record(this.space.makeSpace({ axis: 'y', line, delta: height, ...(band ? { within: { ...band } } : {}) }));
    for (const frame of chain) {
      if (Math.abs(before.get(frame.id)! - line) <= 1 && bottom(frame.bounds) < line + height - 0.5) {
        frame.bounds.height += height;
        this.touched.add(frame.id);
      }
    }
    const ref = siblings[siblings.length - 1]!;
    lane.bounds = { x: ref.bounds.x, y: line, width: ref.bounds.width, height };
    return true;
  }

  /**
   * Closes the lane's band when empty, else lets a sibling take it over.
   * The only lane's band is the whole frame, which keeps its size (audit #39).
   */
  removedLane(box: Box, poolId: string | undefined, parentId: string | undefined): void {
    const pool = poolId ? this.plane.shapes.get(poolId) : undefined;
    const occupied = [...this.plane.shapes.values()].some((shape) => PlaneQuery.isLeaf(shape) && shape.kind !== 'boundary' && cy(shape.bounds) > box.y && cy(shape.bounds) < bottom(box) && (!pool || (shape.bounds.x >= pool.bounds.x && shape.bounds.x <= right(pool.bounds))));
    const siblings = this.siblingLanes(poolId, parentId, '');
    if (!siblings.length) return;
    if (!occupied) {
      this.record(this.space.makeSpace({ axis: 'y', line: bottom(box) - 0.5, delta: -box.height, ...(pool ? { within: { ...pool.bounds } } : {}) }));
      return;
    }
    const above = siblings.find((sibling) => Math.abs(bottom(sibling.bounds) - box.y) <= 1);
    const below = siblings.find((sibling) => Math.abs(sibling.bounds.y - bottom(box)) <= 1);
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
    const below = this.pools().filter((pool) => pool.bounds.y >= bottom(box) - 1);
    if (!below.length) return;
    const next = Math.min(...below.map((pool) => pool.bounds.y));
    const occupied = [...this.plane.shapes.values()].some((shape) => shape.kind !== 'participant' && cy(shape.bounds) > box.y && cy(shape.bounds) < next);
    if (occupied) return;
    this.record(this.space.makeSpace({ axis: 'y', line: next - 0.5, delta: -(next - box.y) }));
  }

  private shiftAll(shapes: DShape[], edges: DEdge[], dx: number, dy: number): void {
    for (const shape of shapes) translateShape(shape, dx, dy);
    for (const edge of edges) translateEdge(edge, dx, dy);
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
    const sideOf = (bounds: Box): Side => {
      const center = { x: cx(bounds), y: cy(bounds) };
      const distances: Array<[Side, number]> = [
        ['bottom', Math.abs(center.y - bottom(old))],
        ['right', Math.abs(center.x - right(old))],
        ['top', Math.abs(center.y - old.y)],
        ['left', Math.abs(center.x - old.x)],
      ];
      return distances.reduce((closest, b2) => (b2[1] < closest[1] ? b2 : closest))[0];
    };
    const horizontal = (side: Side): boolean => side === 'top' || side === 'bottom';
    const opposite: Record<Side, Side> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };
    const along = (bounds: Box, side: Side): number => (horizontal(side) ? cx(bounds) : cy(bounds));
    const span = (box: Box, side: Side): [number, number] => (horizontal(side) ? [box.x, right(box)] : [box.y, bottom(box)]);
    const bySide = new Map<Side, DShape[]>();
    for (const event of events) {
      const side = sideOf(event.bounds);
      bySide.set(side, [...(bySide.get(side) ?? []), event]);
    }
    const placed = new Map<DShape, { side: Side; center: number }>();
    const overflow: Array<[Side, DShape]> = [];
    const fit = (side: Side, list: DShape[], keepOffsets: boolean): void => {
      const sorted = [...list].sort((first, second) => along(first.bounds, side) - along(second.bounds, side));
      const [lo, hi] = span(nb, side);
      const size = (event: DShape): number => (horizontal(side) ? event.bounds.width : event.bounds.height);
      const taken = [...placed.entries()].filter(([, placement]) => placement.side === side);
      const free = (center: number, event: DShape): boolean => center - size(event) / 2 >= lo - 0.5 && center + size(event) / 2 <= hi + 0.5 && taken.every(([other, placement]) => Math.abs(placement.center - center) >= (size(other) + size(event)) / 2 + 4);
      if (keepOffsets) {
        const [, oldHi] = span(old, side);
        const cs = sorted.map((event) => hi - (oldHi - along(event.bounds, side)));
        const ok = sorted.every((event, index) => free(cs[index]!, event) && sorted.every((other, otherIndex) => otherIndex === index || Math.abs(cs[otherIndex]! - cs[index]!) >= (size(other) + size(event)) / 2 + 4));
        if (ok) {
          sorted.forEach((event, index) => placed.set(event, { side, center: cs[index]! }));
          return;
        }
      }
      let center = hi;
      for (const event of [...sorted].reverse()) {
        center = Math.min(center - size(event) / 2 - 7, hi - size(event) / 2 - 7);
        while (!free(center, event) && center - size(event) / 2 >= lo) center -= 4;
        if (free(center, event)) {
          placed.set(event, { side, center });
          taken.push([event, { side, center }]);
          center -= size(event) / 2;
        } else overflow.push([side, event]);
      }
    };
    for (const [side, list] of bySide) fit(side, list, true);
    for (const [side, event] of overflow.splice(0)) fit(opposite[side], [event], false);
    for (const [side, event] of overflow) placed.set(event, { side, center: span(nb, side)[1] - (horizontal(side) ? event.bounds.width : event.bounds.height) / 2 });
    for (const [event, { side, center }] of placed) {
      const width = event.bounds.width;
      const height = event.bounds.height;
      const cx = horizontal(side) ? center : side === 'left' ? nb.x : right(nb);
      const cyv = horizontal(side) ? (side === 'top' ? nb.y : bottom(nb)) : center;
      const dx = Math.round(cx - width / 2) - event.bounds.x;
      const dy = Math.round(cyv - height / 2) - event.bounds.y;
      if (!dx && !dy) continue;
      event.bounds.x += dx;
      event.bounds.y += dy;
      if (event.label) {
        event.label.x += dx;
        event.label.y += dy;
      }
      this.touched.add(event.id);
    }
  }

  /** The content moves to `child`, keeping relative positions. */
  collapse(sub: DShape, child: Plane, gap: number): void {
    const { shapes, edges } = PlaneQuery.contentOf(this.plane, sub.id);
    const old = copyBox(sub.bounds);
    this.shiftAll(shapes, edges, 160 - (old.x + PAD), 80 - (old.y + 45));
    for (const shape of shapes) {
      this.plane.shapes.delete(shape.id);
      if (shape.parentId === sub.id) delete shape.parentId;
      child.shapes.set(shape.id, shape);
    }
    for (const edge of edges) {
      this.plane.edges.delete(edge.id);
      child.edges.set(edge.id, edge);
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

  /**
   * The content of `child` moves in and the space tool makes room.
   * It is a frame from then on, so the space tool never grows it over foreign shapes.
   */
  expand(sub: DShape, child: Plane | undefined, sem: Semantics): void {
    const content = child ? [...child.shapes.values()] : [];
    let box: Box | undefined;
    for (const shape of content) {
      for (const part of [shape.bounds, ...(shape.label ? [shape.label] : [])]) box = box ? union(box, part) : copyBox(part);
    }
    const width = Math.max(350, box ? Math.round(box.width + 2 * PAD) : 0);
    const height = Math.max(200, box ? Math.round(box.height + 45 + PAD) : 0);
    const old = copyBox(sub.bounds);
    sub.expanded = true;
    sub.container = true;
    const keep = new Set(PlaneQuery.boundariesOf(this.plane, sub.id).map((boundary) => boundary.id));
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
    for (const shape of content) {
      child.shapes.delete(shape.id);
      const scope = sem.scopeOf.get(shape.id);
      if (scope && (scope as { id?: string }).id === sub.id) shape.parentId = sub.id;
      if (shape.poolId === undefined && sub.poolId) shape.poolId = sub.poolId;
      this.plane.shapes.set(shape.id, shape);
    }
    for (const edge of edges) {
      child.edges.delete(edge.id);
      this.plane.edges.set(edge.id, edge);
    }
    child.deleted = true;
  }
}
