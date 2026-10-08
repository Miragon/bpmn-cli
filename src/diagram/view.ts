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
 *   - colors: every coloured shape / edge with its swatch name (write.ts
 *     SWATCHES) or 'custom' plus the raw fill / stroke.
 *   - labels: external labels (events, gateways, data, flows) that are not on
 *     the default side (labels.ts defaultLabelSide; flows: above), with the
 *     side they are on.
 *   - metrics: layoutProblems(defs) (counts, score, problems with ids).
 *  Read-only.
 */
import { is, type El } from '../model.js';
import { cx, cy } from './geom.js';
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
}

export interface LayoutDiagram {
  /** BPMNPlane id */
  id: string;
  /** the element the diagram shows */
  root: string;
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
  for (const s of plane.shapes.values()) {
    if (!is(s.el, 'bpmn:FlowNode') || s.kind === 'boundary') continue;
    members.get(parentOf(s))?.push(s);
  }
  const tol = spacingOf(plane).rowTol;
  const children = new Map<string, DShape[]>();
  for (const f of frames) {
    const p = parentOf(f);
    children.set(p, [...(children.get(p) ?? []), f]);
  }
  const groups: LayoutGroup[] = [];
  const visit = (id: string, kind: LayoutGroup['kind'], el: El, parent?: string): void => {
    const name = nameOf(el);
    groups.push({ id, kind, ...(name ? { name } : {}), ...(parent ? { parent } : {}), rows: rowsOf(members.get(id) ?? [], tol) });
    const kids = (children.get(id) ?? []).sort((a, b) => a.bounds.y - b.bounds.y || a.bounds.x - b.bounds.x);
    for (const k of kids) visit(k.id, k.kind === 'participant' ? 'participant' : k.kind === 'lane' ? 'lane' : 'subProcess', k.el, id);
  };
  visit(plane.rootId, rootKind(plane.root), plane.root);
  // an empty collaboration root says nothing
  const out = groups.filter((g) => !(g.kind === 'collaboration' && !g.rows.length));
  for (const g of out) if (g.parent && !out.some((o) => o.id === g.parent)) delete g.parent;
  return { id: plane.id, root: plane.rootId, groups: out };
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
