import type { DEdge, DShape, Plane } from './types.js';
import { clamp, cy, median, right, unionAll, type Box } from '../utils/geom.js';
import { raw } from '../utils/raw.js';

export interface Spacing {
  /** horizontal gap between connected neighbours */
  gap: number;
  /** vertical distance between row centres */
  row: number;
  /** centres closer than this are on the same row */
  rowTol: number;
}

/** Read-only queries on a plane: leaves, a sub-process's content, the spacing it is drawn with. */
export class PlaneQuery {
  /** Shapes that are obstacles and take part in overlap removal: no containers, no groups. */
  static isLeaf(shape: DShape): boolean {
    return !shape.container && shape.kind !== 'group';
  }

  static leaves(plane: Plane): DShape[] {
    return [...plane.shapes.values()].filter(PlaneQuery.isLeaf);
  }

  /** Bounding box of the leaf content of a plane (or of the shapes passing `filter`). */
  static contentBox(plane: Plane, filter: (shape: DShape) => boolean = PlaneQuery.isLeaf): Box | undefined {
    return unionAll([...plane.shapes.values()].filter(filter).map((shape) => shape.bounds));
  }

  /** Shapes and edges drawn inside an expanded sub-process (all depths). */
  static contentOf(plane: Plane, subId: string): { shapes: DShape[]; edges: DEdge[] } {
    const inside = new Set<string>();
    let grew = true;
    while (grew) {
      grew = false;
      for (const shape of plane.shapes.values()) {
        if (inside.has(shape.id)) continue;
        if (shape.parentId === subId || (shape.parentId && inside.has(shape.parentId)) || (shape.hostId && inside.has(shape.hostId))) {
          inside.add(shape.id);
          grew = true;
        }
      }
    }
    const shapes = [...plane.shapes.values()].filter((shape) => inside.has(shape.id));
    const edges = [...plane.edges.values()].filter((edge) => (edge.sourceId && inside.has(edge.sourceId)) || (edge.targetId && inside.has(edge.targetId)));
    return { shapes, edges };
  }

  /** Boundary events attached to a host, in plane order. */
  static boundariesOf(plane: Plane, hostId: string): DShape[] {
    return [...plane.shapes.values()].filter((shape) => shape.hostId === hostId);
  }

  /** Gap and row spacing of a plane, measured on its sequence flows (between the ends `endsOf` names; none: skipped). */
  static spacingOf(plane: Plane, endsOf: (edge: DEdge) => Pick<DEdge, 'sourceId' | 'targetId'> | undefined = (edge) => edge): Spacing {
    const gaps: number[] = [];
    const rows: number[] = [];
    for (const edge of plane.edges.values()) {
      const ends = edge.kind === 'sequenceFlow' ? endsOf(edge) : undefined;
      if (!ends?.sourceId || !ends.targetId) continue;
      const source = plane.shapes.get(ends.sourceId);
      const target = plane.shapes.get(ends.targetId);
      if (!source || !target || source.kind === 'boundary' || source.container || target.container) {
        continue;
      }
      const dy = Math.abs(cy(source.bounds) - cy(target.bounds));
      if (dy <= 5) {
        const gap = target.bounds.x - right(source.bounds);
        if (gap > 0) gaps.push(gap);
      } else if (dy >= 30) {
        rows.push(dy);
      }
    }
    const gap = Math.round(clamp(median(gaps) ?? 60, 40, 100));
    const row = Math.round(clamp(median(rows) ?? 140, 80, 150));
    return { gap, row, rowTol: Math.max(5, row / 4) };
  }

  /** A vertical pool or lane (isHorizontal=false); the incremental layout routes nothing there. */
  static verticalBand(plane: Plane): DShape | undefined {
    return [...plane.shapes.values()].find((shape) => (shape.kind === 'participant' || shape.kind === 'lane') && shape.di && raw<boolean>(shape.di, 'isHorizontal') === false);
  }

  /** The plane a shape or edge with this id is drawn on. */
  static planeWith(planes: readonly Plane[], id: string): Plane | undefined {
    return planes.find((plane) => plane.shapes.has(id) || plane.edges.has(id));
  }
}
