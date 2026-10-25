import { Reordering } from '../ops/Reordering.js';
import { laneSetOf } from '../ops/utils/lanes.js';
import type { OrderOp } from '../ops/types.js';
import { bottom, copyBox, cx, cy, right } from '../drawing/utils/geom.js';
import { idOf, rawList } from '../drawing/utils/raw.js';
import type { DShape } from '../drawing/types.js';
import type { Semantics } from '../drawing/Semantics.js';
import { DrawingSnapshot } from '../drawing/DrawingSnapshot.js';
import type { FormatOps } from './FormatOps.js';

/**
 * The diagram part of an `order` op: lane or pool bands follow the new semantic order,
 * stacked from the top of the first band, carrying their members along.
 */
export class OrderAction {
  constructor(
    private readonly ops: FormatOps,
    private readonly op: OrderOp,
    private readonly snap: DrawingSnapshot,
    private readonly notes: string[],
  ) {}

  private laneSubtree(sem: Semantics, laneId: string): Set<string> {
    const out = new Set([laneId]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const [child, parent] of sem.laneParent) {
        if (out.has(parent) && !out.has(child)) {
          out.add(child);
          grew = true;
        }
      }
    }
    return out;
  }

  private orderBands(): string[] {
    const owner = this.ops.doc.get(this.op.id);
    const set = owner ? laneSetOf(owner) : undefined;
    const lanes = rawList(set, 'lanes').map((l) => idOf(l)!).filter(Boolean);
    const plane = this.ops.planes.find((p) => lanes.length > 0 && lanes.every((id) => p.shapes.has(id)));
    if (!plane) {
      if (this.ops.planes.length) this.notes.push('the lanes are not drawn: nothing to reorder in the diagram');
      return [];
    }
    const bands = lanes.map((id) => plane.shapes.get(id)!);
    const byY = [...bands].sort((a, b) => a.bounds.y - b.bounds.y);
    if (bands.every((b, i) => b === byY[i])) return [];
    // decided before anything moves
    const subtrees = new Map(bands.map((b) => [b.id, this.laneSubtree(this.ops.sem, b.id)]));
    const poolId = bands[0]!.poolId;
    const members = new Map<string, string[]>(bands.map((b) => [b.id, []]));
    for (const s of plane.shapes.values()) {
      if (s.kind === 'participant' || s.hostId || s.parentId) continue;
      let band: string | undefined;
      if (s.kind === 'lane') band = bands.find((b) => b.id !== s.id && subtrees.get(b.id)!.has(s.id))?.id;
      else if (s.laneId) band = bands.find((b) => subtrees.get(b.id)!.has(s.laneId!))?.id;
      else if (s.poolId === poolId && !s.container) band = bands.find((b) => cy(s.bounds) >= b.bounds.y && cy(s.bounds) < bottom(b.bounds))?.id;
      if (band) members.get(band)!.push(s.id);
    }
    let cursor = byY[0]!.bounds.y;
    const moves: Array<{ band: DShape; dy: number }> = [];
    for (const b of bands) {
      moves.push({ band: b, dy: cursor - b.bounds.y });
      cursor += b.bounds.height;
    }
    for (const { band, dy } of moves) {
      if (!dy) continue;
      band.bounds.y += dy;
      for (const id of members.get(band.id)!) {
        const s = plane.shapes.get(id)!;
        if (s.kind === 'lane') s.bounds.y += dy;
        else this.ops.drawing(plane).shift(id, 0, dy);
      }
    }
    // a band whose members hang out at its bottom grows, so nothing lands in the band below
    const pool = poolId ? plane.shapes.get(poolId) : undefined;
    for (const b of bands) {
      const lowest = Math.max(-Infinity, ...members.get(b.id)!.map((id) => plane.shapes.get(id)!).filter((s) => s.kind !== 'lane').map((s) => bottom(this.ops.drawing(plane).unitBox(s))));
      const over = lowest + 5 - bottom(b.bounds);
      if (over > 0.5) this.ops.drawing(plane).makeSpace({ axis: 'y', line: bottom(b.bounds) - 1, delta: Math.ceil(over), ...(pool ? { within: copyBox(pool.bounds) } : {}) });
    }
    return this.ops.drawing(plane).settle(this.snap);
  }

  /** The gaps between the old slots stay; pools that share rows keep their places. */
  private orderPoolBands(): string[] {
    const collab = this.ops.doc.get(this.op.id);
    const ids = rawList(collab, 'participants').map((p) => idOf(p)!).filter(Boolean);
    const plane = this.ops.planes.find((p) => p.rootId === this.op.id);
    const bands = plane ? ids.map((id) => plane.shapes.get(id)).filter((s): s is DShape => !!s) : [];
    if (!plane || bands.length < 2) {
      if (this.ops.planes.length) this.notes.push('fewer than two pools are drawn: nothing to reorder in the diagram');
      return [];
    }
    const byY = [...bands].sort((a, b) => a.bounds.y - b.bounds.y);
    if (bands.every((b, i) => b === byY[i])) return [];
    for (let i = 0; i + 1 < byY.length; i++) {
      if (byY[i + 1]!.bounds.y < bottom(byY[i]!.bounds) - 1) {
        this.notes.push(`the pools are not stacked top to bottom (${byY[i]!.id} and ${byY[i + 1]!.id} share rows): the drawing keeps their places`);
        return [];
      }
    }
    const gaps = byY.slice(1).map((b, i) => b.bounds.y - bottom(byY[i]!.bounds));
    // decided before anything moves
    const members = new Map<string, DShape[]>(bands.map((b) => [b.id, []]));
    for (const s of plane.shapes.values()) {
      if (s.kind === 'participant' || s.hostId || s.parentId) continue;
      let pool = s.poolId && members.has(s.poolId) ? s.poolId : undefined;
      // collaboration-level artifacts (no process) go with the pool they are drawn in
      if (!pool && !s.poolId) pool = bands.find((b) => cy(s.bounds) >= b.bounds.y && cy(s.bounds) <= bottom(b.bounds) && cx(s.bounds) >= b.bounds.x && cx(s.bounds) <= right(b.bounds))?.id;
      if (pool) members.get(pool)!.push(s);
    }
    let cursor = byY[0]!.bounds.y;
    bands.forEach((b, i) => {
      const dy = cursor - b.bounds.y;
      cursor += b.bounds.height + (gaps[i] ?? 0);
      if (!dy) return;
      b.bounds.y += dy;
      for (const s of members.get(b.id)!) {
        if (s.kind === 'lane') s.bounds.y += dy;
        else this.ops.drawing(plane).shift(s.id, 0, dy);
      }
    });
    return this.ops.drawing(plane).settle(this.snap);
  }

  run(): string[] {
    return new Reordering(this.ops.doc, this.op).ordersPools() ? this.orderPoolBands() : this.orderBands();
  }
}
