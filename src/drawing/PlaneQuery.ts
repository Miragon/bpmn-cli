import type { DEdge, DShape, Plane } from './types.js';
import { clamp, cy, median, right, unionAll, type Box } from './utils/geom.js';
import { raw } from './utils/raw.js';

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
  static isLeaf(s: DShape): boolean {
    return !s.container && s.kind !== 'group';
  }

  static leaves(plane: Plane): DShape[] {
    return [...plane.shapes.values()].filter(PlaneQuery.isLeaf);
  }

  /** Bounding box of the leaf content of a plane (or of the shapes passing `filter`). */
  static contentBox(plane: Plane, filter: (s: DShape) => boolean = PlaneQuery.isLeaf): Box | undefined {
    return unionAll([...plane.shapes.values()].filter(filter).map((s) => s.bounds));
  }

  /** Shapes and edges drawn inside an expanded sub-process (all depths). */
  static contentOf(plane: Plane, subId: string): { shapes: DShape[]; edges: DEdge[] } {
    const inside = new Set<string>();
    let grew = true;
    while (grew) {
      grew = false;
      for (const s of plane.shapes.values()) {
        if (inside.has(s.id)) continue;
        if (s.parentId === subId || (s.parentId && inside.has(s.parentId)) || (s.hostId && inside.has(s.hostId))) {
          inside.add(s.id);
          grew = true;
        }
      }
    }
    const shapes = [...plane.shapes.values()].filter((s) => inside.has(s.id));
    const edges = [...plane.edges.values()].filter((e) => (e.sourceId && inside.has(e.sourceId)) || (e.targetId && inside.has(e.targetId)));
    return { shapes, edges };
  }

  /** Boundary events attached to a host, in plane order. */
  static boundariesOf(plane: Plane, hostId: string): DShape[] {
    return [...plane.shapes.values()].filter((s) => s.hostId === hostId);
  }

  /** Gap and row spacing of a plane, measured on its sequence flows. */
  static spacingOf(plane: Plane): Spacing {
    const gaps: number[] = [];
    const rows: number[] = [];
    for (const e of plane.edges.values()) {
      if (e.kind !== 'sequenceFlow' || !e.sourceId || !e.targetId) continue;
      const s = plane.shapes.get(e.sourceId);
      const t = plane.shapes.get(e.targetId);
      if (!s || !t || s.kind === 'boundary' || s.container || t.container) continue;
      const dy = Math.abs(cy(s.bounds) - cy(t.bounds));
      if (dy <= 5) {
        const g = t.bounds.x - right(s.bounds);
        if (g > 0) gaps.push(g);
      } else if (dy >= 30) rows.push(dy);
    }
    const gap = Math.round(clamp(median(gaps) ?? 60, 40, 100));
    const row = Math.round(clamp(median(rows) ?? 140, 80, 150));
    return { gap, row, rowTol: Math.max(5, row / 4) };
  }

  /** A vertical pool or lane (isHorizontal=false); the incremental layout routes nothing there. */
  static verticalBand(plane: Plane): DShape | undefined {
    return [...plane.shapes.values()].find((s) => (s.kind === 'participant' || s.kind === 'lane') && s.di && raw<boolean>(s.di, 'isHorizontal') === false);
  }

  /** The plane a shape or edge with this id is drawn on. */
  static planeWith(planes: readonly Plane[], id: string): Plane | undefined {
    return planes.find((p) => p.shapes.has(id) || p.edges.has(id));
  }
}
