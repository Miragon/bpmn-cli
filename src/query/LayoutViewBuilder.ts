import { is, type El } from '../model/utils/moddle.js';
import { cx, cy, right } from '../drawing/utils/geom.js';
import { PlaneQuery } from '../drawing/PlaneQuery.js';
import { defaultLabelSide, edgeLabelSideOf, hasExternalLabel, labelSideOf } from '../drawing/utils/labels.js';
import { LayoutAnalysis } from '../drawing/LayoutAnalysis.js';
import { raw } from '../drawing/utils/raw.js';
import { DiagramReader } from '../drawing/DiagramReader.js';
import { Semantics } from '../drawing/Semantics.js';
import type { DShape, Plane } from '../drawing/types.js';
import { swatchOf } from '../drawing/utils/colors.js';
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
      for (const s of plane.shapes.values()) {
        const c = s.di ? swatchOf(s.di) : undefined;
        if (c) colors.push({ id: s.id, ...c });
        if (!s.label || !hasExternalLabel(s) || !LayoutViewBuilder.nameOf(s.el)) continue;
        const host = s.hostId ? plane.shapes.get(s.hostId)?.bounds : undefined;
        const side = labelSideOf(s, host);
        const def = defaultLabelSide(s.kind);
        if (side && side !== def) labels.push({ id: s.id, side, default: def });
      }
      for (const e of plane.edges.values()) {
        const c = e.di ? swatchOf(e.di) : undefined;
        if (c) colors.push({ id: e.id, ...c });
        if (!e.label || !LayoutViewBuilder.nameOf(e.el)) continue;
        const side = edgeLabelSideOf(e);
        if (side && side !== 'above') labels.push({ id: e.id, side, default: 'above' });
      }
    }
    return { diagrams: planes.map((p) => LayoutViewBuilder.diagramOf(p, sem.laneParent)), colors, labels, metrics: LayoutAnalysis.of(this.defs) };
  }

  private static diagramOf(plane: Plane, laneParent: Map<string, string>): LayoutDiagram {
    const frames = [...plane.shapes.values()].filter((s) => s.kind === 'participant' || s.kind === 'lane' || (s.kind === 'subProcess' && s.container));
    const drawn = (id: string | undefined): string | undefined => (id && plane.shapes.has(id) ? id : undefined);
    const parentOf = (s: DShape): string => {
      if (s.kind === 'participant') return plane.rootId;
      if (s.kind === 'lane') return drawn(laneParent.get(s.id)) ?? drawn(s.poolId) ?? plane.rootId;
      return drawn(s.parentId) ?? drawn(s.laneId) ?? drawn(s.poolId) ?? plane.rootId;
    };
    const members = new Map<string, DShape[]>([[plane.rootId, []], ...frames.map((f) => [f.id, []] as [string, DShape[]])]);
    const cols = new DiagramColumns(plane);
    for (const s of cols.nodes) members.get(parentOf(s))?.push(s);
    const tol = PlaneQuery.spacingOf(plane).rowTol;
    const children = new Map<string, DShape[]>();
    for (const f of frames) {
      const p = parentOf(f);
      children.set(p, [...(children.get(p) ?? []), f]);
    }
    const groups: LayoutGroup[] = [];
    const visit = (id: string, kind: LayoutGroup['kind'], el: El, parent?: string): void => {
      const name = LayoutViewBuilder.nameOf(el);
      const rows = LayoutViewBuilder.rowsOf(members.get(id) ?? [], tol);
      const columns = rows.map((r) => r.map((n) => cols.of.get(n) ?? 0));
      const gaps = rows.flatMap((r, i) => {
        const before = r.flatMap((n, k) => (k > 0 && plane.shapes.get(n)!.bounds.x - right(plane.shapes.get(r[k - 1]!)!.bounds) > cols.wide ? [k] : []));
        return before.length ? [{ row: i, before }] : [];
      });
      groups.push({ id, kind, ...(name ? { name } : {}), ...(parent ? { parent } : {}), rows, columns, ...(gaps.length ? { gaps } : {}) });
      const kids = (children.get(id) ?? []).sort((a, b) => a.bounds.y - b.bounds.y || a.bounds.x - b.bounds.x);
      for (const k of kids) visit(k.id, k.kind === 'participant' ? 'participant' : k.kind === 'lane' ? 'lane' : 'subProcess', k.el, id);
    };
    visit(plane.rootId, LayoutViewBuilder.rootKind(plane.root), plane.root);
    // an empty collaboration root says nothing
    const out = groups.filter((g) => !(g.kind === 'collaboration' && !g.rows.length));
    for (const g of out) if (g.parent && !out.some((o) => o.id === g.parent)) delete g.parent;
    return { id: plane.id, root: plane.rootId, columns: cols.count, gaps: cols.gaps, groups: out };
  }

  /** Rows of shapes: centres within `tol` of a row's first shape share it. */
  private static rowsOf(shapes: DShape[], tol: number): string[][] {
    const sorted = [...shapes].sort((a, b) => cy(a.bounds) - cy(b.bounds) || cx(a.bounds) - cx(b.bounds));
    const rows: DShape[][] = [];
    for (const s of sorted) {
      const row = rows[rows.length - 1];
      if (row && cy(s.bounds) - cy(row[0]!.bounds) <= tol) row.push(s);
      else rows.push([s]);
    }
    return rows.map((r) => r.sort((a, b) => cx(a.bounds) - cx(b.bounds)).map((s) => s.id));
  }

  private static rootKind(root: El): LayoutGroup['kind'] {
    if (is(root, 'bpmn:Collaboration')) return 'collaboration';
    if (is(root, 'bpmn:Process')) return 'process';
    return 'subProcess';
  }

  private static nameOf(el: El): string | undefined {
    const n = raw<string>(el, 'name');
    return n && n.trim() ? n.replace(/\s+/g, ' ').trim() : undefined;
  }
}
