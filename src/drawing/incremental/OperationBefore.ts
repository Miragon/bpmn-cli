import { Box, Polyline, type Point } from '../../model/index.js';
import type { PlaneEdge } from '../plane/PlaneEdge.js';
import type { PlaneShape } from '../plane/PlaneShape.js';
import { Frames } from '../plane/Frames.js';
import type { Plane } from '../plane/Plane.js';
import type { EdgeBefore, EdgeRouter } from './routing/EdgeRouter.js';

export interface PlaneRoutes {
  plane: Plane;
  routes: Pick<EdgeRouter, 'edgeBefore'>;
}

export class OperationBefore {
  readonly bounds = new Map<string, Box>();
  readonly points = new Map<string, Point[]>();
  readonly edges = new Map<PlaneEdge, EdgeBefore>();
  readonly labels = new Map<string, Box>();

  constructor(private readonly drawings: readonly PlaneRoutes[]) {
    for (const { plane, routes } of drawings) {
      for (const shape of plane.shapes.values()) {
        this.keepShape(shape);
      }
      for (const edge of plane.edges.values()) {
        this.points.set(edge.id, new Polyline(edge.points).copy());
        this.edges.set(edge, routes.edgeBefore(edge));
        this.keepLabel(edge);
      }
    }
  }

  unchanged(edge: PlaneEdge): boolean {
    const old = this.points.get(edge.id);
    return !!old && new Polyline(old).same(new Polyline(edge.points));
  }

  clearOfTitle(owner: PlaneShape | PlaneEdge, sub: PlaneShape): boolean {
    const label = this.labels.get(owner.id);
    const bounds = this.bounds.get(sub.id);
    const title = bounds ? Frames.titleBox(bounds, sub.el.peek<string>('name')) : undefined;
    return !label || !title || !label.overlaps(title);
  }

  changedShapes(): string[] {
    return this.drawings.flatMap(({ plane }) => [...plane.shapes.values()].filter((shape) => this.boxChanged(shape)).map((shape) => shape.id));
  }

  changedEdges(): string[] {
    return this.drawings.flatMap(({ plane }) => [...plane.edges.values()].filter((edge) => this.pointsChanged(edge)).map((edge) => edge.id));
  }

  private keepShape(shape: PlaneShape): void {
    this.bounds.set(shape.id, shape.bounds.copy());
    this.keepLabel(shape);
  }

  private keepLabel({ id, label }: PlaneShape | PlaneEdge): void {
    if (label) {
      this.labels.set(id, label.copy());
    }
  }

  private boxChanged({ id, bounds }: PlaneShape): boolean {
    const box = this.bounds.get(id);
    return !!box && !Box.same(box, bounds);
  }

  private pointsChanged({ id, points }: PlaneEdge): boolean {
    const old = this.points.get(id);
    return !!old && !new Polyline(old).same(new Polyline(points));
  }
}
