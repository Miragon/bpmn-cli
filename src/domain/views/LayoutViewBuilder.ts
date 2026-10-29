import { is, type El } from '../document/utils/moddle.js';
import { cx, cy, right } from '../diagram/utils/geom.js';
import { PlaneQuery } from '../diagram/di/PlaneQuery.js';
import { defaultLabelSide, edgeLabelSideOf, hasExternalLabel, labelSideOf } from '../diagram/utils/labels.js';
import { LayoutAnalysis } from '../diagram/di/LayoutAnalysis.js';
import { raw } from '../diagram/utils/raw.js';
import { DiagramReader } from '../diagram/di/DiagramReader.js';
import { Semantics } from '../diagram/di/Semantics.js';
import type { DShape, Plane } from '../diagram/di/types.js';
import { swatchOf } from '../diagram/utils/colors.js';
import { DiagramColumns } from './DiagramColumns.js';
import type { LayoutColor, LayoutDiagram, LayoutGroup, LayoutLabel, LayoutView } from './layout-view.js';

/** The drawing as an agent reads it, without coordinates: `bpmn show <file> --layout`. */
export class LayoutViewBuilder {
  constructor(private readonly defs: El) {}

  build(): LayoutView {
    const sem = Semantics.of(this.defs);
    const planes = new DiagramReader(this.defs, sem).planes();
    const colors: LayoutColor[] = [];
    const labels: LayoutLabel[] = [];
    for (const plane of planes) {
      for (const shape of plane.shapes.values()) {
        const swatch = shape.di ? swatchOf(shape.di) : undefined;
        if (swatch) colors.push({ id: shape.id, ...swatch });
        if (!shape.label || !hasExternalLabel(shape) || !LayoutViewBuilder.nameOf(shape.el)) {
          continue;
        }
        const host = shape.hostId ? plane.shapes.get(shape.hostId)?.bounds : undefined;
        const side = labelSideOf(shape, host);
        const def = defaultLabelSide(shape.kind);
        if (side && side !== def) labels.push({ id: shape.id, side, default: def });
      }
      for (const edge of plane.edges.values()) {
        const swatch = edge.di ? swatchOf(edge.di) : undefined;
        if (swatch) colors.push({ id: edge.id, ...swatch });
        if (!edge.label || !LayoutViewBuilder.nameOf(edge.el)) continue;
        const side = edgeLabelSideOf(edge);
        if (side && side !== 'above') {
          labels.push({ id: edge.id, side, default: 'above' });
        }
      }
    }
    return { diagrams: planes.map((plane) => LayoutViewBuilder.diagramOf(plane, sem.laneParent)), colors, labels, metrics: LayoutAnalysis.of(this.defs) };
  }

  /** An empty collaboration root says nothing and is left out. */
  private static diagramOf(plane: Plane, laneParent: Map<string, string>): LayoutDiagram {
    const frames = [...plane.shapes.values()].filter((shape) => shape.kind === 'participant' || shape.kind === 'lane' || (shape.kind === 'subProcess' && shape.container));
    const drawn = (id: string | undefined): string | undefined => (id && plane.shapes.has(id) ? id : undefined);
    const parentOf = (shape: DShape): string => {
      if (shape.kind === 'participant') return plane.rootId;
      if (shape.kind === 'lane') {
        return drawn(laneParent.get(shape.id)) ?? drawn(shape.poolId) ?? plane.rootId;
      }
      return drawn(shape.parentId) ?? drawn(shape.laneId) ?? drawn(shape.poolId) ?? plane.rootId;
    };
    const members = new Map<string, DShape[]>([[plane.rootId, []], ...frames.map((frame) => [frame.id, []] as [string, DShape[]])]);
    const cols = new DiagramColumns(plane);
    for (const shape of cols.nodes) {
      members.get(parentOf(shape))?.push(shape);
    }
    const tol = PlaneQuery.spacingOf(plane).rowTol;
    const children = new Map<string, DShape[]>();
    for (const frame of frames) {
      const parentId = parentOf(frame);
      children.set(parentId, [...(children.get(parentId) ?? []), frame]);
    }
    const groups: LayoutGroup[] = [];
    const visit = (id: string, kind: LayoutGroup['kind'], el: El, parent?: string): void => {
      const name = LayoutViewBuilder.nameOf(el);
      const rows = LayoutViewBuilder.rowsOf(members.get(id) ?? [], tol);
      const columns = rows.map((row) => row.map((nodeId) => cols.of.get(nodeId) ?? 0));
      const gaps = rows.flatMap((row, rowIndex) => {
        const before = row.flatMap((nodeId, position) => (position > 0 && plane.shapes.get(nodeId)!.bounds.x - right(plane.shapes.get(row[position - 1]!)!.bounds) > cols.wide ? [position] : []));
        return before.length ? [{ row: rowIndex, before }] : [];
      });
      groups.push({ id, kind, ...(name ? { name } : {}), ...(parent ? { parent } : {}), rows, columns, ...(gaps.length ? { gaps } : {}) });
      const kids = (children.get(id) ?? []).sort((first, second) => first.bounds.y - second.bounds.y || first.bounds.x - second.bounds.x);
      for (const kid of kids) {
        visit(kid.id, kid.kind === 'participant' ? 'participant' : kid.kind === 'lane' ? 'lane' : 'subProcess', kid.el, id);
      }
    };
    visit(plane.rootId, LayoutViewBuilder.rootKind(plane.root), plane.root);
    const out = groups.filter((group) => !(group.kind === 'collaboration' && !group.rows.length));
    for (const group of out) {
      if (group.parent && !out.some((other) => other.id === group.parent)) {
        delete group.parent;
      }
    }
    return { id: plane.id, root: plane.rootId, columns: cols.count, gaps: cols.gaps, groups: out };
  }

  /** Rows of shapes: centres within `tol` of a row's first shape share it. */
  private static rowsOf(shapes: DShape[], tol: number): string[][] {
    const sorted = [...shapes].sort((first, second) => cy(first.bounds) - cy(second.bounds) || cx(first.bounds) - cx(second.bounds));
    const rows: DShape[][] = [];
    for (const shape of sorted) {
      const row = rows[rows.length - 1];
      if (row && cy(shape.bounds) - cy(row[0]!.bounds) <= tol) {
        row.push(shape);
      } else {
        rows.push([shape]);
      }
    }
    return rows.map((row) => row.sort((first, second) => cx(first.bounds) - cx(second.bounds)).map((shape) => shape.id));
  }

  private static rootKind(root: El): LayoutGroup['kind'] {
    if (is(root, 'bpmn:Collaboration')) return 'collaboration';
    if (is(root, 'bpmn:Process')) return 'process';
    return 'subProcess';
  }

  private static nameOf(el: El): string | undefined {
    const name = raw<string>(el, 'name');
    return name && name.trim() ? name.replace(/\s+/g, ' ').trim() : undefined;
  }
}
