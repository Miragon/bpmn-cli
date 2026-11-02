import type { Box, Point } from '../../../model/index.js';
import type { PlaneEdge } from '../../plane/PlaneEdge.js';
import type { PlaneShape } from '../../plane/PlaneShape.js';
import type { Plane } from '../../plane/Plane.js';
import { Semantics } from '../../plane/Semantics.js';

export class EdgeObstacles {
  private static readonly MAX_DEPTH = 12;

  constructor(private readonly plane: Plane) {}

  static solidFor({ kind, isLeaf, container }: PlaneShape, edge: PlaneEdge): boolean {
    return isLeaf || (kind === 'subProcess' && container) || (edge.kind === 'messageFlow' && kind === 'participant');
  }

  ancestors(shape: PlaneShape): Set<string> {
    const ancestors = new Set<string>();
    let current: PlaneShape | undefined = shape;
    for (let depth = 0; current && depth < EdgeObstacles.MAX_DEPTH; depth++) {
      for (const id of [current.parentId, current.laneId, current.poolId]) {
        if (id) {
          ancestors.add(id);
        }
      }
      current = current.parentId ? this.plane.shapes.get(current.parentId) : undefined;
    }
    return ancestors;
  }

  around(edge: PlaneEdge, ...ends: PlaneShape[]): Box[] {
    const keepOut = new Set(ends.flatMap((end) => [end.id, ...this.ancestors(end)]));
    return [...this.plane.shapes.values()].filter((shape) => !keepOut.has(shape.id) && EdgeObstacles.solidFor(shape, edge)).map((shape) => shape.bounds);
  }

  freeLines(): Set<readonly Point[]> {
    return new Set([...this.plane.edges.values()].filter((edge) => Semantics.isAnnotationLine(edge.el)).map((edge) => edge.points));
  }
}
