import { Polyline, type Point } from '../../../model/index.js';
import { DrawnEdge } from '../../../scoring/index.js';
import type { DEdge } from '../../plane/DEdge.js';
import type { Plane } from '../../plane/Plane.js';
import { Semantics } from '../../plane/Semantics.js';
import type { LayoutRun } from './LayoutRun.js';
import type { RepairGuard } from './RepairGuard.js';

export type Crossing = [fresh: DEdge, kept: DEdge, plane: Plane];

export class CrossingReroutes {
  private static readonly RUN_SLACK = 20;

  constructor(
    private readonly run: LayoutRun,
    private readonly guard: RepairGuard,
  ) {}

  private static crossing(first: readonly Point[], second: readonly Point[]): boolean {
    return new Polyline(first).crosses(new Polyline(second));
  }

  crossings(): Crossing[] {
    return this.run.planes.flatMap((plane) => {
      const lines = [...plane.edges.values()].filter((edge) => edge.points.length >= 2 && !Semantics.isAnnotationLine(edge.el));
      const fresh = lines.filter((edge) => this.run.newEdges.has(edge.id));
      const kept = lines.filter((edge) => !this.run.newEdges.has(edge.id));
      return fresh.flatMap((freshEdge) => kept.filter((edge) => CrossingReroutes.crossing(freshEdge.points, edge.points)).map((edge): Crossing => [freshEdge, edge, plane]));
    });
  }

  reroute(rerouted: string[]): void {
    for (const crossing of this.crossings()) {
      const [fresh, kept] = crossing;
      if (!CrossingReroutes.crossing(fresh.points, kept.points)) {
        continue;
      }
      for (const target of [fresh, kept]) {
        if (this.guard.exhausted) {
          return;
        }
        if (this.routeAgain(target, crossing, rerouted)) {
          break;
        }
      }
    }
  }

  private routeAgain(target: DEdge, [fresh, kept, plane]: Crossing, rerouted: string[]): boolean {
    const drawing = this.run.drawing(plane);
    const points = drawing.routes.routeEdge(target, { lines: drawing.routes.routingLines(target.id) });
    if (!points || points.length < 2 || new Polyline(points).same(new Polyline(target.points))) {
      return false;
    }
    const other = target === fresh ? kept : fresh;
    if (CrossingReroutes.crossing(points, other.points) || (target === kept && (this.crossesDrawnLine(plane, target, points) || this.runsAlongDrawnLines(plane, target, points)))) {
      return false;
    }
    this.guard.begin();
    const { points: oldPoints } = target;
    const oldLabel = target.label?.copy();
    drawing.adoptRoute(target, points);
    if (!this.guard.keeps()) {
      target.points = oldPoints;
      target.label = oldLabel;
      return false;
    }
    if (target === kept) {
      if (!rerouted.includes(kept.id)) {
        rerouted.push(kept.id);
      }
      this.run.notes.push(`${kept.id} routed again: it crossed the new ${fresh.id}`);
    }
    return true;
  }

  private crossesDrawnLine(plane: Plane, target: DEdge, points: readonly Point[]): boolean {
    return [...plane.edges.values()].some((other) => other !== target && !this.run.newEdges.has(other.id) && other.points.length >= 2 && !Semantics.isAnnotationLine(other.el) && CrossingReroutes.crossing(points, other.points) && !CrossingReroutes.crossing(target.points, other.points));
  }

  private runsAlongDrawnLines(plane: Plane, target: DEdge, points: Point[]): boolean {
    return this.lengthAlong(plane, target, points) > this.lengthAlong(plane, target, target.points) + CrossingReroutes.RUN_SLACK;
  }

  private lengthAlong(plane: Plane, target: DEdge, points: readonly Point[]): number {
    const segments = new Polyline(points).segments();
    let length = 0;
    for (const other of plane.edges.values()) {
      const sharesEnd = [other.sourceId, other.targetId].some((end) => end === target.sourceId || end === target.targetId);
      if (other !== target && !this.run.newEdges.has(other.id) && !sharesEnd) {
        for (const theirs of new Polyline(other.points).segments()) {
          length += segments.reduce((sum, segment) => sum + Math.max(0, DrawnEdge.collinearLength(segment, theirs)), 0);
        }
      }
    }
    return length;
  }
}
