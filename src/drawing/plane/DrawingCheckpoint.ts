import { Polyline, type Box, type Point } from '../../model/index.js';
import type { PlaneEdge } from './PlaneEdge.js';
import type { PlaneShape } from './PlaneShape.js';
import type { Plane } from './Plane.js';

interface SavedShape {
  bounds: Box;
  label: Box | undefined;
}

interface SavedEdge {
  points: Point[];
  label: Box | undefined;
  sourceId: string | undefined;
  targetId: string | undefined;
}

export class DrawingCheckpoint {
  private readonly shapes = new Map<PlaneShape, SavedShape>();
  private readonly edges = new Map<PlaneEdge, SavedEdge>();

  constructor(plane?: Plane) {
    if (plane) {
      this.keepPlane(plane);
    }
  }

  keepPlane(plane: Plane): void {
    plane.shapes.forEach((shape) => this.keepShape(shape));
    plane.edges.forEach((edge) => this.keepEdge(edge));
  }

  keepShape(shape: PlaneShape): void {
    if (!this.shapes.has(shape)) {
      this.shapes.set(shape, { bounds: shape.bounds.copy(), label: shape.label?.copy() });
    }
  }

  keepEdge(edge: PlaneEdge): void {
    if (!this.edges.has(edge)) {
      this.edges.set(edge, { points: new Polyline(edge.points).copy(), label: edge.label?.copy(), sourceId: edge.sourceId, targetId: edge.targetId });
    }
  }

  boundsOf(shape: PlaneShape): Box {
    return this.shapes.get(shape)!.bounds;
  }

  restore(): void {
    for (const [shape, saved] of this.shapes) {
      shape.bounds = saved.bounds.copy();
      shape.label = saved.label?.copy();
    }
    for (const [edge, saved] of this.edges) {
      edge.points = new Polyline(saved.points).copy();
      edge.label = saved.label?.copy();
      edge.sourceId = saved.sourceId;
      edge.targetId = saved.targetId;
    }
  }
}
