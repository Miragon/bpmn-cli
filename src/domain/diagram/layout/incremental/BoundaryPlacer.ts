import { SIZES } from '../../utils/sizes.js';
import { bottom, type Box, cx, cy, overlaps, pathHits, type Point, right } from '../../utils/geom.js';
import { idOf, raw } from '../../utils/raw.js';
import { PlaneQuery } from '../../di/PlaneQuery.js';

import type { DShape, Plane } from '../../di/types.js';
import { attachedSide } from '../../utils/sides.js';
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
    const centre = { x: cx(event), y: cy(event) };
    const inX = centre.x >= host.x - tol && centre.x <= right(host) + tol;
    const inY = centre.y >= host.y - tol && centre.y <= bottom(host) + tol;
    const near = Math.min(Math.abs(centre.x - host.x), Math.abs(centre.x - right(host)), Math.abs(centre.y - host.y), Math.abs(centre.y - bottom(host))) <= tol;
    return inX && inY && near;
  }

  /** A host drawn after its boundary events: they go on its border, keeping their DI and labels. */
  reattachBoundaries(plane: Plane, host: DShape): void {
    for (const boundary of PlaneQuery.boundariesOf(plane, host.id)) {
      if (this.onBorder(boundary.bounds, host.bounds)) continue;
      plane.shapes.delete(boundary.id);
      this.placer.reuse.set(boundary.id, { shape: boundary, boundaries: [], from: plane });
      if (this.placeBoundary(plane, boundary.id)) {
        this.placer.placed.delete(boundary.id);
        this.placer.moved.add(boundary.id);
      } else {
        this.placer.reuse.delete(boundary.id);
        plane.shapes.set(boundary.id, boundary);
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
   * A spot on the bottom border keeps the lane below clear of other labels (its flow leaves
   * downwards) and none takes a spot where connections already dock on the host.
   */
  private boundarySpot(plane: Plane, host: DShape, size: { width: number; height: number }, self?: string): Box {
    const hb = host.bounds;
    const others = PlaneQuery.boundariesOf(plane, host.id).filter((boundary) => boundary.id !== self).map((boundary) => boundary.bounds);
    const offset = Math.min(SIZES.event.width / 2 + 7, hb.width / 2);
    const labels = [...plane.shapes.values()].filter((other) => other.id !== host.id && other.id !== self && other.label).map((other) => other.label!);
    const exitClear = (box: Box): boolean => box.y < hb.y || !labels.some((label) => overlaps(label, { x: cx(box) - 2, y: bottom(box), width: 4, height: 40 }));
    const docks: Point[] = [];
    for (const edge of plane.edges.values()) {
      if (edge.points.length < 2 || (self && edge.sourceId === self)) continue;
      if (edge.sourceId === host.id) docks.push(edge.points[0]!);
      if (edge.targetId === host.id) docks.push(edge.points[edge.points.length - 1]!);
    }
    const onDock = (box: Box): boolean => docks.some((dock) => dock.x > box.x - 4 && dock.x < right(box) + 4 && dock.y > box.y - 4 && dock.y < bottom(box) + 4);
    let strict = true;
    const free = (box: Box): boolean => !others.some((other) => overlaps(other, box, 4)) && !onDock(box) && (!strict || (exitClear(box) && !labels.some((label) => overlaps(label, box, 2))));
    for (const [centreY, clear] of [[bottom(hb) - size.height / 2, true], [bottom(hb) - size.height / 2, false], [hb.y - size.height / 2, false]] as const) {
      strict = clear;
      const centres: number[] = [];
      for (let centre = right(hb) - offset; centre >= hb.x + size.width / 2 - 0.5; centre -= 4) centres.push(centre);
      for (let centre = right(hb) - offset + 4; centre <= right(hb); centre += 4) centres.push(centre);
      for (const centre of centres) {
        const cand = { x: Math.round(centre - size.width / 2), y: Math.round(centreY), ...size };
        if (free(cand)) return cand;
      }
    }
    return { x: Math.round(right(hb) - offset - size.width / 2), y: Math.round(bottom(hb) - size.height / 2), ...size };
  }

  /** The flow out of an event on the bottom border needs room: shapes right below move down. */
  private makeRoomBelow(plane: Plane, host: DShape, event: Box): void {
    const zone = { x: event.x - 10, y: bottom(host.bounds), width: event.width + 20, height: event.height / 2 + 35 };
    const own = new Set([host.id, ...PlaneQuery.boundariesOf(plane, host.id).map((boundary) => boundary.id)]);
    const blockers = [...plane.shapes.values()].filter((other) => !own.has(other.id) && (PlaneQuery.isLeaf(other) || (other.kind === 'subProcess' && other.container && other.id !== host.parentId)) && overlaps(other.bounds, zone));
    if (!blockers.length) return;
    const top = Math.min(...blockers.map((blocker) => blocker.bounds.y));
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
    const top = Math.round(hb.y - size.height / 2);
    const others = PlaneQuery.boundariesOf(plane, host.id).filter((boundary) => boundary.id !== event.id).map((boundary) => boundary.bounds);
    const docks: Point[] = [];
    for (const edge of plane.edges.values()) {
      if (edge.points.length < 2 || edge.sourceId === event.id) continue;
      if (edge.sourceId === host.id) docks.push(edge.points[0]!);
      if (edge.targetId === host.id) docks.push(edge.points[edge.points.length - 1]!);
    }
    const labels = [...plane.shapes.values(), ...plane.edges.values()].filter((other) => other.id !== host.id && other.id !== event.id && other.label).map((other) => other.label!);
    /**
     * a line through the spot (a rework line right above the host) would be routed again around
     * the event, mostly with a crossing; the event's own flow does not count
     */
    const lines = [...plane.edges.values()].filter((edge) => edge.sourceId !== event.id).map((edge) => edge.points);
    const onLine = (box: Box): boolean => lines.some((pts) => pathHits(pts, box, -4));
    const free = (box: Box): boolean => !others.some((other) => overlaps(other, box, 4)) && !docks.some((dock) => dock.x > box.x - 4 && dock.x < right(box) + 4 && dock.y > box.y - 4 && dock.y < bottom(box) + 4) && !labels.some((label) => overlaps(label, box, 2)) && !onLine(box);
    const lo = hb.x + size.width / 2;
    const hi = right(hb) - size.width / 2;
    const start = Math.min(hi, Math.max(lo, cx(event.bounds)));
    for (let distance = 0; distance <= hb.width; distance += 4) {
      for (const centre of distance ? [start + distance, start - distance] : [start]) {
        const box = { x: Math.round(centre - size.width / 2), y: top, ...size };
        if (centre >= lo - 0.5 && centre <= hi + 0.5 && free(box)) return box;
      }
    }
    return undefined;
  }

  /**
   * Rows above the host for the first node of a path from an event on the bottom border placed
   * by the CLI, when the path starts with this node and the top border has a free spot. They cost
   * TOP_ROW more than a row below: a clean row below wins, one crossing a line loses.
   * An event drawn by hand keeps its border; the CLI's sits where placeBoundary puts it.
   */
  topCandidates(plane: Plane, id: string, probe: Probe, event: DShape, host: DShape, frame: DShape | undefined, size: { width: number; height: number }, extent: number, exclude: ReadonlySet<string>): Cand[] {
    if (attachedSide(event.bounds, host.bounds) !== 'bottom') return [];
    if (!this.placer.placed.has(event.id)) {
      const spot = this.boundarySpot(plane, host, { width: event.bounds.width, height: event.bounds.height }, event.id);
      if (Math.abs(spot.x - event.bounds.x) > 1 || Math.abs(spot.y - event.bounds.y) > 1) return [];
    }
    if (this.placer.sem.successors(event.id).some((successorId) => successorId !== id && plane.shapes.has(successorId))) return [];
    const spot = this.topSpot(plane, event, host);
    if (!spot) return [];
    const sp = this.placer.spacingFor(plane);
    const xs = [right(host.bounds) + sp.gap, Math.round(cx(spot) - size.width / 2)];
    return xs.flatMap((centreX, xi) => this.rows.rowsAbove(plane, probe, frame, event, centreX, size, extent, cy(host.bounds) - sp.row, sp.row, exclude, TOP_ROW + 40 * xi, spot));
  }

  /**
   * Moves a boundary event to its spot on the host's top border (its path goes above next).
   * Its label is placed again once its path is drawn.
   */
  seatOnTop(plane: Plane, event: DShape, spot: Box): void {
    const moved = this.placer.drawing(plane).shift(event.id, spot.x - event.bounds.x, spot.y - event.bounds.y);
    for (const movedId of moved) if (!this.placer.placed.has(movedId)) this.placer.moved.add(movedId);
    if (event.label) (this.placer.relabel ??= new Set()).add(event.id);
    this.placer.notes.push(`${event.id} moved to the top border of ${event.hostId}: its path runs above it (below, it would cross a line or take more room)`);
  }
}
