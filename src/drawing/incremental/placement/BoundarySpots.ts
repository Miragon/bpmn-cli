import { Box, Polyline, type Point } from '../../../model/index.js';
import type { PlaneEdge } from '../../plane/PlaneEdge.js';
import type { PlaneShape } from '../../plane/PlaneShape.js';
import type { Plane } from '../../plane/Plane.js';
import { ShapeSizes, type ShapeSize } from '../../plane/ShapeSizes.js';

export class BoundarySpots {
  private static readonly STEP = 4;
  private static readonly DOCK_MARGIN = 4;
  private static readonly HOST_LABEL_MARGIN = 2;
  private static readonly EXIT_DEPTH = 40;
  private static readonly LINE_REACH = -4;

  constructor(private readonly plane: Plane) {}

  private static onDock(box: Box, docks: readonly Point[]): boolean {
    const margin = BoundarySpots.DOCK_MARGIN;
    return docks.some(({ x, y }) => x > box.x - margin && x < box.right + margin && y > box.y - margin && y < box.bottom + margin);
  }

  private static centresAlong(host: Box, width: number, offset: number): number[] {
    const centres: number[] = [];
    for (let centre = host.right - offset; centre >= host.x + width / 2 - 0.5; centre -= BoundarySpots.STEP) {
      centres.push(centre);
    }
    for (let centre = host.right - offset + BoundarySpots.STEP; centre <= host.right; centre += BoundarySpots.STEP) {
      centres.push(centre);
    }
    return centres;
  }

  spotOnBorder(host: PlaneShape, size: ShapeSize, self?: string): Box {
    const hostBox = host.bounds;
    const others = this.plane.boundariesOf(host.id).filter((boundary) => boundary.id !== self).map((boundary) => boundary.bounds);
    const offset = Math.min(ShapeSizes.EVENT.width / 2 + 7, hostBox.width / 2);
    const labels = [...this.plane.shapes.values()].filter((other) => other.id !== host.id && other.id !== self && other.label).map((other) => other.label!);
    const docks = this.docksOn(host, (edge) => !self || edge.sourceId !== self);
    const exitClear = (box: Box): boolean => box.y < hostBox.y || !labels.some((label) => label.overlaps(new Box(box.center.x - 2, box.bottom, BoundarySpots.STEP, BoundarySpots.EXIT_DEPTH)));
    const free = (box: Box, strict: boolean): boolean => !others.some((other) => other.overlaps(box, BoundarySpots.DOCK_MARGIN)) && !BoundarySpots.onDock(box, docks) && (!strict || (exitClear(box) && !labels.some((label) => label.overlaps(box, BoundarySpots.HOST_LABEL_MARGIN))));
    const onBottom = hostBox.bottom - size.height / 2;
    const passes = [[onBottom, true], [onBottom, false], [hostBox.y - size.height / 2, false]] as const;
    for (const [top, strict] of passes) {
      for (const centre of BoundarySpots.centresAlong(hostBox, size.width, offset)) {
        const spot = new Box(Math.round(centre - size.width / 2), Math.round(top), size.width, size.height);
        if (free(spot, strict)) {
          return spot;
        }
      }
    }
    return new Box(Math.round(hostBox.right - offset - size.width / 2), Math.round(onBottom), size.width, size.height);
  }

  spotOnTop(event: PlaneShape, host: PlaneShape): Box | undefined {
    const hostBox = host.bounds;
    const { width, height } = event.bounds;
    const top = Math.round(hostBox.y - height / 2);
    const free = this.topSpotTest(event, host);
    const low = hostBox.x + width / 2;
    const high = hostBox.right - width / 2;
    const start = Math.min(high, Math.max(low, event.bounds.center.x));
    for (let distance = 0; distance <= hostBox.width; distance += BoundarySpots.STEP) {
      for (const centre of distance ? [start + distance, start - distance] : [start]) {
        const box = new Box(Math.round(centre - width / 2), top, width, height);
        if (centre >= low - 0.5 && centre <= high + 0.5 && free(box)) {
          return box;
        }
      }
    }
    return undefined;
  }

  private topSpotTest(event: PlaneShape, host: PlaneShape): (box: Box) => boolean {
    const { shapes, edges } = this.plane;
    const others = this.plane.boundariesOf(host.id).filter((boundary) => boundary.id !== event.id).map((boundary) => boundary.bounds);
    const docks = this.docksOn(host, (edge) => edge.sourceId !== event.id);
    const labels = [...shapes.values(), ...edges.values()].filter((other) => other.id !== host.id && other.id !== event.id && other.label).map((other) => other.label!);
    const lines = [...edges.values()].filter((edge) => edge.sourceId !== event.id).map((edge) => new Polyline(edge.points));
    return (box) => !others.some((other) => other.overlaps(box, BoundarySpots.DOCK_MARGIN)) && !BoundarySpots.onDock(box, docks) && !labels.some((label) => label.overlaps(box, BoundarySpots.HOST_LABEL_MARGIN)) && !lines.some((line) => line.hits(box, BoundarySpots.LINE_REACH));
  }

  private docksOn(host: PlaneShape, counts: (edge: PlaneEdge) => boolean): Point[] {
    const docks: Point[] = [];
    for (const edge of this.plane.edges.values()) {
      if (edge.points.length >= 2 && counts(edge)) {
        if (edge.sourceId === host.id) {
          docks.push(edge.points[0]!);
        }
        if (edge.targetId === host.id) {
          docks.push(edge.points.at(-1)!);
        }
      }
    }
    return docks;
  }
}
