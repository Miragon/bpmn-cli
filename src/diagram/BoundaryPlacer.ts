import { SIZES } from './utils/sizes.js';
import { bottom, cx, cy, overlaps, pathHits, right, type Box, type Point } from './utils/geom.js';
import { idOf, raw } from './utils/raw.js';
import { PlaneQuery } from './PlaneQuery.js';

import type { DShape, Plane } from './types.js';
import { attachedSide } from './utils/sides.js';
import type { NodePlacer, Probe } from './NodePlacer.js';
import type { PlacementObstacles } from './PlacementObstacles.js';
import { TOP_ROW, type Cand, type RowChooser } from './RowChooser.js';

/**
 * Boundary events on their host: a spot on the bottom border (then the top border) with room
 * below, events of a host drawn late put back on its border, and a path above the host with the
 * event moved to the top border.
 */
export class BoundaryPlacer {
  constructor(
    private readonly placer: NodePlacer,
    private readonly obstacles: PlacementObstacles,
    private readonly rows: RowChooser,
  ) {}

  /** The centre of a boundary event lies on its host's border (a few px tolerance). */
  private onBorder(event: Box, host: Box, tol = 6): boolean {
    const c = { x: cx(event), y: cy(event) };
    const inX = c.x >= host.x - tol && c.x <= right(host) + tol;
    const inY = c.y >= host.y - tol && c.y <= bottom(host) + tol;
    const near = Math.min(Math.abs(c.x - host.x), Math.abs(c.x - right(host)), Math.abs(c.y - host.y), Math.abs(c.y - bottom(host))) <= tol;
    return inX && inY && near;
  }

  /** A host drawn after its boundary events: they go on its border, keeping their DI and labels. */
  reattachBoundaries(plane: Plane, host: DShape): void {
    for (const b of PlaneQuery.boundariesOf(plane, host.id)) {
      if (this.onBorder(b.bounds, host.bounds)) continue;
      plane.shapes.delete(b.id);
      this.placer.reuse.set(b.id, { shape: b, boundaries: [], from: plane });
      if (this.placeBoundary(plane, b.id)) {
        this.placer.placed.delete(b.id);
        this.placer.moved.add(b.id);
      } else {
        this.placer.reuse.delete(b.id);
        plane.shapes.set(b.id, b);
      }
    }
  }

  /** Places a boundary event on its host's bottom border. */
  placeBoundary(plane: Plane, id: string): boolean {
    const el = this.placer.sem.byId.get(id)!;
    const hostId = idOf(raw(el, 'attachedToRef'));
    const host = hostId ? plane.shapes.get(hostId) : undefined;
    if (!host) return false;
    const box = this.boundarySpot(plane, host, this.placer.sizeFor(plane, id));
    if (box.y > host.bounds.y) this.makeRoomBelow(plane, host, box);
    this.placer.commit(plane, this.placer.newShape(plane, id, box));
    return true;
  }

  /**
   * The bottom border right to left (corner included), then the top border; first with a clear
   * exit. `self`: an event already drawn there, left out (where a command would have put it).
   */
  private boundarySpot(plane: Plane, host: DShape, size: { width: number; height: number }, self?: string): Box {
    const hb = host.bounds;
    const others = PlaneQuery.boundariesOf(plane, host.id).filter((b) => b.id !== self).map((b) => b.bounds);
    const offset = Math.min(SIZES.event.width / 2 + 7, hb.width / 2);
    // the flow leaves a bottom boundary event downwards: keep that lane clear of other labels
    const labels = [...plane.shapes.values()].filter((o) => o.id !== host.id && o.id !== self && o.label).map((o) => o.label!);
    const exitClear = (b: Box): boolean => b.y < hb.y || !labels.some((l) => overlaps(l, { x: b.x + b.width / 2 - 2, y: bottom(b), width: 4, height: 40 }));
    // where connections already dock on the host (an event there would force them around)
    const docks: Point[] = [];
    for (const e of plane.edges.values()) {
      if (e.points.length < 2 || (self && e.sourceId === self)) continue;
      if (e.sourceId === host.id) docks.push(e.points[0]!);
      if (e.targetId === host.id) docks.push(e.points[e.points.length - 1]!);
    }
    const onDock = (b: Box): boolean => docks.some((p) => p.x > b.x - 4 && p.x < right(b) + 4 && p.y > b.y - 4 && p.y < bottom(b) + 4);
    let strict = true;
    const free = (b: Box): boolean => !others.some((o) => overlaps(o, b, 4)) && !onDock(b) && (!strict || (exitClear(b) && !labels.some((l) => overlaps(l, b, 2))));
    for (const [y, clear] of [[bottom(hb) - size.height / 2, true], [bottom(hb) - size.height / 2, false], [hb.y - size.height / 2, false]] as const) {
      strict = clear;
      const centres: number[] = [];
      for (let c = right(hb) - offset; c >= hb.x + size.width / 2 - 0.5; c -= 4) centres.push(c);
      for (let c = right(hb) - offset + 4; c <= right(hb); c += 4) centres.push(c);
      for (const c of centres) {
        const cand = { x: Math.round(c - size.width / 2), y: Math.round(y), ...size };
        if (free(cand)) return cand;
      }
    }
    return { x: Math.round(right(hb) - offset - size.width / 2), y: Math.round(bottom(hb) - size.height / 2), ...size };
  }

  /** The flow out of an event on the bottom border needs room: shapes right below move down. */
  private makeRoomBelow(plane: Plane, host: DShape, event: Box): void {
    const zone = { x: event.x - 10, y: bottom(host.bounds), width: event.width + 20, height: event.height / 2 + 35 };
    const own = new Set([host.id, ...PlaneQuery.boundariesOf(plane, host.id).map((b) => b.id)]);
    const blockers = [...plane.shapes.values()].filter((o) => !own.has(o.id) && (PlaneQuery.isLeaf(o) || (o.kind === 'subProcess' && o.container && o.id !== host.parentId)) && overlaps(o.bounds, zone));
    if (!blockers.length) return;
    const top = Math.min(...blockers.map((b) => b.bounds.y));
    if (top < bottom(host.bounds) - 0.5) return;
    this.placer.recordSpace(this.placer.drawing(plane).makeSpace({ axis: 'y', line: top - 0.5, delta: Math.ceil(bottom(zone) + 10 - top), anchors: [host.id], ...this.obstacles.spaceBand(plane, host, host) }));
  }

  /**
   * The spot on the host's top border nearest the event's column that no other boundary event,
   * docking connection, label or line takes (like `place --side top`), or undefined.
   */
  private topSpot(plane: Plane, event: DShape, host: DShape): Box | undefined {
    const hb = host.bounds;
    const size = { width: event.bounds.width, height: event.bounds.height };
    const y = Math.round(hb.y - size.height / 2);
    const others = PlaneQuery.boundariesOf(plane, host.id).filter((b) => b.id !== event.id).map((b) => b.bounds);
    const docks: Point[] = [];
    for (const e of plane.edges.values()) {
      if (e.points.length < 2 || e.sourceId === event.id) continue;
      if (e.sourceId === host.id) docks.push(e.points[0]!);
      if (e.targetId === host.id) docks.push(e.points[e.points.length - 1]!);
    }
    const labels = [...plane.shapes.values(), ...plane.edges.values()].filter((o) => o.id !== host.id && o.id !== event.id && o.label).map((o) => o.label!);
    /**
     * a line through the spot (a rework line right above the host) would be routed again around
     * the event, mostly with a crossing; the event's own flow does not count
     */
    const lines = [...plane.edges.values()].filter((e) => e.sourceId !== event.id).map((e) => e.points);
    const onLine = (b: Box): boolean => lines.some((pts) => pathHits(pts, b, -4));
    const free = (b: Box): boolean => !others.some((o) => overlaps(o, b, 4)) && !docks.some((p) => p.x > b.x - 4 && p.x < right(b) + 4 && p.y > b.y - 4 && p.y < bottom(b) + 4) && !labels.some((l) => overlaps(l, b, 2)) && !onLine(b);
    const lo = hb.x + size.width / 2;
    const hi = right(hb) - size.width / 2;
    const start = Math.min(hi, Math.max(lo, cx(event.bounds)));
    for (let d = 0; d <= hb.width; d += 4) {
      for (const c of d ? [start + d, start - d] : [start]) {
        const b = { x: Math.round(c - size.width / 2), y, ...size };
        if (c >= lo - 0.5 && c <= hi + 0.5 && free(b)) return b;
      }
    }
    return undefined;
  }

  /**
   * Rows above the host for the first node of a path from an event on the bottom border placed
   * by the CLI, when the path starts with this node and the top border has a free spot. They cost
   * TOP_ROW more than a row below: a clean row below wins, one crossing a line loses.
   */
  topCandidates(plane: Plane, id: string, probe: Probe, event: DShape, host: DShape, frame: DShape | undefined, size: { width: number; height: number }, extent: number, exclude: ReadonlySet<string>): Cand[] {
    if (attachedSide(event.bounds, host.bounds) !== 'bottom') return [];
    // an event drawn by hand keeps its border; the CLI's sits where placeBoundary puts it
    if (!this.placer.placed.has(event.id)) {
      const spot = this.boundarySpot(plane, host, { width: event.bounds.width, height: event.bounds.height }, event.id);
      if (Math.abs(spot.x - event.bounds.x) > 1 || Math.abs(spot.y - event.bounds.y) > 1) return [];
    }
    if (this.placer.sem.successors(event.id).some((n) => n !== id && plane.shapes.has(n))) return [];
    const spot = this.topSpot(plane, event, host);
    if (!spot) return [];
    const sp = this.placer.spacingFor(plane);
    const xs = [right(host.bounds) + sp.gap, Math.round(cx(spot) - size.width / 2)];
    return xs.flatMap((x, xi) => this.rows.rowsAbove(plane, probe, frame, event, x, size, extent, cy(host.bounds) - sp.row, sp.row, exclude, TOP_ROW + 40 * xi, spot));
  }

  /** Moves a boundary event to its spot on the host's top border (its path goes above next). */
  seatOnTop(plane: Plane, event: DShape, spot: Box): void {
    const moved = this.placer.drawing(plane).shift(event.id, spot.x - event.bounds.x, spot.y - event.bounds.y);
    for (const m of moved) if (!this.placer.placed.has(m)) this.placer.moved.add(m);
    // its label is placed again once its path is drawn
    if (event.label) (this.placer.relabel ??= new Set()).add(event.id);
    this.placer.notes.push(`${event.id} moved to the top border of ${event.hostId}: its path runs above it (below, it would cross a line or take more room)`);
  }
}
