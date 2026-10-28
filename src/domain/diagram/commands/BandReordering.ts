import { laneSetOf } from '../../document/utils/lanes.js';
import type { ReorderElements } from '../../commands/types.js';
import { ReorderTarget } from '../../commands/ReorderTarget.js';
import { bottom, copyBox, cx, cy, right } from '../utils/geom.js';
import { idOf, rawList } from '../utils/raw.js';
import type { DShape } from '../di/types.js';
import type { Semantics } from '../di/Semantics.js';
import { DrawingSnapshot } from '../layout/incremental/DrawingSnapshot.js';
import type { DrawnDiagram } from '../DrawnDiagram.js';

/**
 * The diagram part of an `order` op: lane or pool bands follow the new semantic order,
 * stacked from the top of the first band, carrying their members along.
 */
export class BandReordering {
  constructor(
    private readonly diagram: DrawnDiagram,
    private readonly command: ReorderElements,
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

  /**
   * Restacks the lanes in their model order; the members of each band are decided before anything
   * moves. A band whose members hang out at its bottom grows, so nothing lands in the band below.
   */
  private orderBands(): string[] {
    const owner = this.diagram.doc.get(this.command.id);
    const set = owner ? laneSetOf(owner) : undefined;
    const lanes = rawList(set, 'lanes').map((lane) => idOf(lane)!).filter(Boolean);
    const plane = this.diagram.planes.find((candidate) => lanes.length > 0 && lanes.every((id) => candidate.shapes.has(id)));
    if (!plane) {
      if (this.diagram.planes.length) this.notes.push('the lanes are not drawn: nothing to reorder in the diagram');
      return [];
    }
    const bands = lanes.map((id) => plane.shapes.get(id)!);
    const byY = [...bands].sort((one, other) => one.bounds.y - other.bounds.y);
    if (bands.every((band, index) => band === byY[index])) return [];
    const subtrees = new Map(bands.map((band) => [band.id, this.laneSubtree(this.diagram.sem, band.id)]));
    const poolId = bands[0]!.poolId;
    const members = new Map<string, string[]>(bands.map((band) => [band.id, []]));
    for (const shape of plane.shapes.values()) {
      if (shape.kind === 'participant' || shape.hostId || shape.parentId) continue;
      let band: string | undefined;
      if (shape.kind === 'lane') band = bands.find((candidate) => candidate.id !== shape.id && subtrees.get(candidate.id)!.has(shape.id))?.id;
      else if (shape.laneId) band = bands.find((candidate) => subtrees.get(candidate.id)!.has(shape.laneId!))?.id;
      else if (shape.poolId === poolId && !shape.container) band = bands.find((candidate) => cy(shape.bounds) >= candidate.bounds.y && cy(shape.bounds) < bottom(candidate.bounds))?.id;
      if (band) members.get(band)!.push(shape.id);
    }
    let cursor = byY[0]!.bounds.y;
    const moves: Array<{ band: DShape; dy: number }> = [];
    for (const band of bands) {
      moves.push({ band, dy: cursor - band.bounds.y });
      cursor += band.bounds.height;
    }
    for (const { band, dy } of moves) {
      if (!dy) continue;
      band.bounds.y += dy;
      for (const id of members.get(band.id)!) {
        const shape = plane.shapes.get(id)!;
        if (shape.kind === 'lane') shape.bounds.y += dy;
        else this.diagram.drawing(plane).shift(id, 0, dy);
      }
    }
    const pool = poolId ? plane.shapes.get(poolId) : undefined;
    for (const band of bands) {
      const lowest = Math.max(-Infinity, ...members.get(band.id)!.map((id) => plane.shapes.get(id)!).filter((member) => member.kind !== 'lane').map((member) => bottom(this.diagram.drawing(plane).unitBox(member))));
      const over = lowest + 5 - bottom(band.bounds);
      if (over > 0.5) this.diagram.drawing(plane).makeSpace({ axis: 'y', line: bottom(band.bounds) - 1, delta: Math.ceil(over), ...(pool ? { within: copyBox(pool.bounds) } : {}) });
    }
    return this.diagram.drawing(plane).settle(this.snap);
  }

  /**
   * The gaps between the old slots stay; pools that share rows keep their places.
   * The members of each pool are decided before anything moves; collaboration-level artifacts (no
   * process) go with the pool they are drawn in.
   */
  private orderPoolBands(): string[] {
    const collab = this.diagram.doc.get(this.command.id);
    const ids = rawList(collab, 'participants').map((participant) => idOf(participant)!).filter(Boolean);
    const plane = this.diagram.planes.find((candidate) => candidate.rootId === this.command.id);
    const bands = plane ? ids.map((id) => plane.shapes.get(id)).filter((shape): shape is DShape => !!shape) : [];
    if (!plane || bands.length < 2) {
      if (this.diagram.planes.length) this.notes.push('fewer than two pools are drawn: nothing to reorder in the diagram');
      return [];
    }
    const byY = [...bands].sort((one, other) => one.bounds.y - other.bounds.y);
    if (bands.every((band, index) => band === byY[index])) return [];
    for (let index = 0; index + 1 < byY.length; index++) {
      if (byY[index + 1]!.bounds.y < bottom(byY[index]!.bounds) - 1) {
        this.notes.push(`the pools are not stacked top to bottom (${byY[index]!.id} and ${byY[index + 1]!.id} share rows): the drawing keeps their places`);
        return [];
      }
    }
    const gaps = byY.slice(1).map((band, index) => band.bounds.y - bottom(byY[index]!.bounds));
    const members = new Map<string, DShape[]>(bands.map((band) => [band.id, []]));
    for (const shape of plane.shapes.values()) {
      if (shape.kind === 'participant' || shape.hostId || shape.parentId) continue;
      let pool = shape.poolId && members.has(shape.poolId) ? shape.poolId : undefined;
      if (!pool && !shape.poolId) pool = bands.find((band) => cy(shape.bounds) >= band.bounds.y && cy(shape.bounds) <= bottom(band.bounds) && cx(shape.bounds) >= band.bounds.x && cx(shape.bounds) <= right(band.bounds))?.id;
      if (pool) members.get(pool)!.push(shape);
    }
    let cursor = byY[0]!.bounds.y;
    bands.forEach((band, index) => {
      const dy = cursor - band.bounds.y;
      cursor += band.bounds.height + (gaps[index] ?? 0);
      if (!dy) return;
      band.bounds.y += dy;
      for (const member of members.get(band.id)!) {
        if (member.kind === 'lane') member.bounds.y += dy;
        else this.diagram.drawing(plane).shift(member.id, 0, dy);
      }
    });
    return this.diagram.drawing(plane).settle(this.snap);
  }

  run(): string[] {
    return new ReorderTarget(this.diagram.doc, this.command).ordersPools() ? this.orderPoolBands() : this.orderBands();
  }
}
