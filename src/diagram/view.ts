/**
 * The drawing as an agent reads it, without coordinates: `bpmn show <file>
 * --layout`.
 *
 * CONTRACT
 *  layoutView(defs) returns, per diagram (BPMNPlane, document order):
 *   - groups: the frames of the drawing as a tree, in reading order (top to
 *     bottom, then left to right): the plane root (process, collaboration or
 *     collapsed sub-process), pools, lanes (nested lanes under their parent)
 *     and expanded sub-processes. Each group lists the flow nodes directly in
 *     it (boundary events follow their host and are left out) as rows: node
 *     ids clustered by centre y (same row when within max(5, row spacing / 4)
 *     of the row's first node, spacingOf), rows top to bottom, each row left
 *     to right. A node belongs to its expanded parent sub-process, else its
 *     lane, else its pool, else the root.
 *   - columns: the flow nodes of the whole diagram clustered by centre x
 *     (same column when within clamp(gap / 2, 10, 40) of the column's first
 *     node), numbered c0.. left to right; `columns` of a group gives the
 *     column of every node of its rows (same shape as `rows`), so x order
 *     can be compared across lanes and pools. `gaps` of the diagram are the
 *     wide empty strips between two neighbouring columns (free width more
 *     than one column of the drawing, median task width + 2 gaps: room
 *     `compact` can close), `gaps` of a group the places in its rows where
 *     two neighbours are that far apart (index of the node after the gap):
 *     such a row holds unrelated clusters that merely share a y.
 *   - colors: every coloured shape / edge with its swatch name (write.ts
 *     SWATCHES) or 'custom' plus the raw fill / stroke.
 *   - labels: external labels (events, gateways, data, flows) that are not on
 *     the default side (labels.ts defaultLabelSide; flows: above), with the
 *     side they are on.
 *   - metrics: layoutProblems(defs) (counts, score, problems with ids).
 *  Read-only.
 */
import { is, type El } from '../model.js';
import { cx, cy, median, right } from './geom.js';
import { defaultLabelSide, edgeLabelSideOf, hasExternalLabel, labelSideOf, type LabelSide } from './labels.js';
import { layoutProblems, type LayoutMetrics } from './metrics.js';
import { spacingOf } from './place.js';
import { raw, readPlanes, semantics, type DShape, type Plane } from './plane.js';
import { swatchOf, type SwatchName } from './write.js';

export interface LayoutGroup {
  /** the frame: plane root, participant, lane or expanded sub-process */
  id: string;
  kind: 'process' | 'collaboration' | 'participant' | 'lane' | 'subProcess';
  name?: string;
  /** the enclosing group */
  parent?: string;
  /** node ids per row: rows top to bottom, each left to right */
  rows: string[][];
  /** the diagram column (c0..) of every node of `rows`, same shape */
  columns: number[][];
  /** per row: indexes of the nodes a wide empty gap lies before (only rows that have one; omitted when none has) */
  gaps?: Array<{ row: number; before: number[] }>;
}

export interface LayoutGap {
  /** the gap lies between column `after` and column `after + 1` */
  after: number;
  /** free width in px */
  width: number;
}

export interface LayoutDiagram {
  /** BPMNPlane id */
  id: string;
  /** the element the diagram shows */
  root: string;
  /** number of columns (c0 .. c<columns - 1>) */
  columns: number;
  /** wide empty strips between neighbouring columns */
  gaps: LayoutGap[];
  groups: LayoutGroup[];
}

export interface LayoutColor {
  id: string;
  color: SwatchName | 'custom';
  fill?: string;
  stroke?: string;
}

export interface LayoutLabel {
  id: string;
  side: LabelSide | 'inside';
  default: LabelSide;
}

export interface LayoutView {
  diagrams: LayoutDiagram[];
  colors: LayoutColor[];
  labels: LayoutLabel[];
  metrics: LayoutMetrics;
}

function nameOf(el: El): string | undefined {
  const n = raw<string>(el, 'name');
  return n && n.trim() ? n.replace(/\s+/g, ' ').trim() : undefined;
}

/** Rows of shapes: centres within `tol` of a row's first shape share it. */
function rowsOf(shapes: DShape[], tol: number): string[][] {
  const sorted = [...shapes].sort((a, b) => cy(a.bounds) - cy(b.bounds) || cx(a.bounds) - cx(b.bounds));
  const rows: DShape[][] = [];
  for (const s of sorted) {
    const row = rows[rows.length - 1];
    if (row && cy(s.bounds) - cy(row[0]!.bounds) <= tol) row.push(s);
    else rows.push([s]);
  }
  return rows.map((r) => r.sort((a, b) => cx(a.bounds) - cx(b.bounds)).map((s) => s.id));
}

interface Columns {
  /** node id -> column index */
  of: Map<string, number>;
  count: number;
  gaps: LayoutGap[];
  /** free width above which a gap counts as wide */
  wide: number;
}

/** The columns of a diagram's flow nodes (see module contract). */
function columnsOf(plane: Plane, nodes: DShape[]): Columns {
  const sp = spacingOf(plane);
  const tol = Math.min(40, Math.max(10, sp.gap / 2));
  const tasks = nodes.filter((s) => s.kind === 'task').map((s) => s.bounds.width);
  const wide = (median(tasks) ?? 100) + 2 * sp.gap;
  const sorted = [...nodes].sort((a, b) => cx(a.bounds) - cx(b.bounds) || cy(a.bounds) - cy(b.bounds));
  const cols: DShape[][] = [];
  for (const s of sorted) {
    const col = cols[cols.length - 1];
    if (col && cx(s.bounds) - cx(col[0]!.bounds) <= tol) col.push(s);
    else cols.push([s]);
  }
  const of = new Map<string, number>();
  cols.forEach((col, i) => col.forEach((s) => of.set(s.id, i)));
  const gaps: LayoutGap[] = [];
  for (let i = 0; i + 1 < cols.length; i++) {
    const free = Math.min(...cols[i + 1]!.map((s) => s.bounds.x)) - Math.max(...cols[i]!.map((s) => right(s.bounds)));
    if (free > wide) gaps.push({ after: i, width: Math.round(free) });
  }
  return { of, count: cols.length, gaps, wide };
}

function rootKind(root: El): LayoutGroup['kind'] {
  if (is(root, 'bpmn:Collaboration')) return 'collaboration';
  if (is(root, 'bpmn:Process')) return 'process';
  return 'subProcess';
}

function diagramOf(plane: Plane, laneParent: Map<string, string>): LayoutDiagram {
  const frames = [...plane.shapes.values()].filter((s) => s.kind === 'participant' || s.kind === 'lane' || (s.kind === 'subProcess' && s.container));
  const drawn = (id: string | undefined): string | undefined => (id && plane.shapes.has(id) ? id : undefined);
  const parentOf = (s: DShape): string => {
    if (s.kind === 'participant') return plane.rootId;
    if (s.kind === 'lane') return drawn(laneParent.get(s.id)) ?? drawn(s.poolId) ?? plane.rootId;
    return drawn(s.parentId) ?? drawn(s.laneId) ?? drawn(s.poolId) ?? plane.rootId;
  };
  const members = new Map<string, DShape[]>([[plane.rootId, []], ...frames.map((f) => [f.id, []] as [string, DShape[]])]);
  const nodes: DShape[] = [];
  for (const s of plane.shapes.values()) {
    if (!is(s.el, 'bpmn:FlowNode') || s.kind === 'boundary') continue;
    nodes.push(s);
    members.get(parentOf(s))?.push(s);
  }
  const tol = spacingOf(plane).rowTol;
  const cols = columnsOf(plane, nodes);
  const children = new Map<string, DShape[]>();
  for (const f of frames) {
    const p = parentOf(f);
    children.set(p, [...(children.get(p) ?? []), f]);
  }
  const groups: LayoutGroup[] = [];
  const visit = (id: string, kind: LayoutGroup['kind'], el: El, parent?: string): void => {
    const name = nameOf(el);
    const rows = rowsOf(members.get(id) ?? [], tol);
    const columns = rows.map((r) => r.map((n) => cols.of.get(n) ?? 0));
    const gaps = rows.flatMap((r, i) => {
      const before = r.flatMap((n, k) => (k > 0 && plane.shapes.get(n)!.bounds.x - right(plane.shapes.get(r[k - 1]!)!.bounds) > cols.wide ? [k] : []));
      return before.length ? [{ row: i, before }] : [];
    });
    groups.push({ id, kind, ...(name ? { name } : {}), ...(parent ? { parent } : {}), rows, columns, ...(gaps.length ? { gaps } : {}) });
    const kids = (children.get(id) ?? []).sort((a, b) => a.bounds.y - b.bounds.y || a.bounds.x - b.bounds.x);
    for (const k of kids) visit(k.id, k.kind === 'participant' ? 'participant' : k.kind === 'lane' ? 'lane' : 'subProcess', k.el, id);
  };
  visit(plane.rootId, rootKind(plane.root), plane.root);
  // an empty collaboration root says nothing
  const out = groups.filter((g) => !(g.kind === 'collaboration' && !g.rows.length));
  for (const g of out) if (g.parent && !out.some((o) => o.id === g.parent)) delete g.parent;
  return { id: plane.id, root: plane.rootId, columns: cols.count, gaps: cols.gaps, groups: out };
}

/** The drawing without coordinates (see module contract). */
export function layoutView(defs: El): LayoutView {
  const sem = semantics(defs);
  const planes = readPlanes(defs, sem);
  const colors: LayoutColor[] = [];
  const labels: LayoutLabel[] = [];
  for (const plane of planes) {
    for (const s of plane.shapes.values()) {
      const c = s.di ? swatchOf(s.di) : undefined;
      if (c) colors.push({ id: s.id, ...c });
      if (!s.label || !hasExternalLabel(s) || !nameOf(s.el)) continue;
      const host = s.hostId ? plane.shapes.get(s.hostId)?.bounds : undefined;
      const side = labelSideOf(s, host);
      const def = defaultLabelSide(s.kind);
      if (side && side !== def) labels.push({ id: s.id, side, default: def });
    }
    for (const e of plane.edges.values()) {
      const c = e.di ? swatchOf(e.di) : undefined;
      if (c) colors.push({ id: e.id, ...c });
      if (!e.label || !nameOf(e.el)) continue;
      const side = edgeLabelSideOf(e);
      if (side && side !== 'above') labels.push({ id: e.id, side, default: 'above' });
    }
  }
  return { diagrams: planes.map((p) => diagramOf(p, sem.laneParent)), colors, labels, metrics: layoutProblems(defs) };
}
