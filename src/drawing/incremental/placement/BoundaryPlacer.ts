import { Box, type BpmnElement } from '../../../model/index.js';
import type { DShape } from '../../plane/DShape.js';
import type { Plane } from '../../plane/Plane.js';
import { ShapeSides } from '../../plane/ShapeSides.js';
import { BoundarySpots } from './BoundarySpots.js';
import type { PlacementObstacles } from './PlacementObstacles.js';
import type { PlacementState, Probe } from './PlacementState.js';
import { RowChooser, type RowSearch } from './RowChooser.js';
import type { Cand } from './RowCosts.js';

export class BoundaryPlacer {
  private static readonly BORDER_TOLERANCE = 6;

  constructor(
    private readonly state: PlacementState,
    private readonly obstacles: PlacementObstacles,
    private readonly rows: RowChooser,
  ) {}

  private static onBorder(event: Box, host: Box): boolean {
    const tolerance = BoundaryPlacer.BORDER_TOLERANCE;
    const { x, y } = event.center;
    const inside = x >= host.x - tolerance && x <= host.right + tolerance && y >= host.y - tolerance && y <= host.bottom + tolerance;
    return inside && Math.min(Math.abs(x - host.x), Math.abs(x - host.right), Math.abs(y - host.y), Math.abs(y - host.bottom)) <= tolerance;
  }

  reattachBoundaries(plane: Plane, host: DShape): void {
    for (const boundary of plane.boundariesOf(host.id)) {
      if (BoundaryPlacer.onBorder(boundary.bounds, host.bounds)) {
        continue;
      }
      plane.shapes.delete(boundary.id);
      this.state.reuse.set(boundary.id, { shape: boundary, boundaries: [], from: plane });
      if (this.placeBoundary(plane, boundary.id)) {
        this.state.placed.delete(boundary.id);
        this.state.moved.add(boundary.id);
      } else {
        this.state.reuse.delete(boundary.id);
        plane.shapes.set(boundary.id, boundary);
      }
    }
  }

  placeBoundary(plane: Plane, id: string): boolean {
    const hostId = this.state.semantics.byId.get(id)?.peek<BpmnElement>('attachedToRef')?.peek<string>('id');
    const host = hostId ? plane.shapes.get(hostId) : undefined;
    if (!host) {
      return false;
    }
    const box = new BoundarySpots(plane).spotOnBorder(host, this.state.sizeFor(id));
    if (box.y > host.bounds.y) {
      this.makeRoomBelow(plane, host, box);
    }
    this.state.commit(plane, this.state.newShape(plane, id, box));
    return true;
  }

  topCandidates(plane: Plane, id: string, probe: Probe, event: DShape, host: DShape, frame: DShape | undefined, search: RowSearch): Cand[] {
    if (ShapeSides.attached(event.bounds, host.bounds) !== 'bottom' || !this.sitsWhereTheCliPutsIt(plane, event, host)) {
      return [];
    }
    if (this.state.semantics.successors(event.id).some((successor) => successor !== id && plane.shapes.has(successor))) {
      return [];
    }
    const spot = new BoundarySpots(plane).spotOnTop(event, host);
    if (!spot) {
      return [];
    }
    const { gap, row } = this.state.spacingFor(plane);
    const lefts = [host.bounds.right + gap, Math.round(spot.center.x - search.size.width / 2)];
    return lefts.flatMap((left, rank) => this.rows.rowsAbove(plane, probe, frame, { ...search, left }, { anchor: event, start: host.bounds.center.y - row, step: row, penalty: RowChooser.TOP_ROW + 40 * rank, top: spot }));
  }

  seatOnTop(plane: Plane, event: DShape, spot: Box): void {
    const moved = this.state.drawing(plane).space.shiftShape(event.id, spot.x - event.bounds.x, spot.y - event.bounds.y);
    moved.filter((id) => !this.state.placed.has(id)).forEach((id) => this.state.moved.add(id));
    if (event.label) {
      this.state.relabel.add(event.id);
    }
    this.state.notes.push(`${event.id} moved to the top border of ${event.hostId}: its path runs above it (below, it would cross a line or take more room)`);
  }

  private makeRoomBelow(plane: Plane, host: DShape, event: Box): void {
    const zone = new Box(event.x - 10, host.bounds.bottom, event.width + 20, event.height / 2 + 35);
    const own = new Set([host.id, ...plane.boundariesOf(host.id).map((boundary) => boundary.id)]);
    const blockers = [...plane.shapes.values()].filter((other) => !own.has(other.id) && (other.isLeaf || (other.kind === 'subProcess' && other.container && other.id !== host.parentId)) && other.bounds.overlaps(zone));
    if (!blockers.length) {
      return;
    }
    const top = Math.min(...blockers.map((blocker) => blocker.bounds.y));
    if (top >= host.bounds.bottom - 0.5) {
      this.state.recordSpace(this.state.drawing(plane).space.makeSpace({ axis: 'y', line: top - 0.5, delta: Math.ceil(zone.bottom + 10 - top), anchors: [host.id], ...this.obstacles.spaceBand(plane, host, host) }));
    }
  }

  private sitsWhereTheCliPutsIt(plane: Plane, event: DShape, host: DShape): boolean {
    if (this.state.placed.has(event.id)) {
      return true;
    }
    const { width, height } = event.bounds;
    const spot = new BoundarySpots(plane).spotOnBorder(host, { width, height }, event.id);
    return Math.abs(spot.x - event.bounds.x) <= 1 && Math.abs(spot.y - event.bounds.y) <= 1;
  }
}
