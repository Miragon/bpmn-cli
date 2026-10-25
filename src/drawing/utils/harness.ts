import { cx } from './geom.js';
/**
 * Geometry and lenient DI reading of the layout metrics, matching the regression harness:
 * every shape and edge counts and bounds and waypoints are taken without a finite check.
 */
import { is, type El } from '../../model/utils/moddle.js';
import type { Box, Point } from '../types.js';
import { idOf, raw, rawList } from './raw.js';
import { titleBox } from './text.js';

export type Seg = [Point, Point];

export function segs(pts: Point[]): Seg[] {
  const out: Seg[] = [];
  for (let i = 0; i + 1 < pts.length; i++) out.push([pts[i]!, pts[i + 1]!]);
  return out;
}

export const hits = ([p, q]: Seg, b: Box, shrink = 2): boolean =>
  Math.min(p.x, q.x) < b.x + b.width - shrink &&
  Math.max(p.x, q.x) > b.x + shrink &&
  Math.min(p.y, q.y) < b.y + b.height - shrink &&
  Math.max(p.y, q.y) > b.y + shrink;

function slab(p: number, d: number, lo: number, hi: number): [number, number] {
  const a = (lo - p) / d;
  const b = (hi - p) / d;
  return a < b ? [a, b] : [b, a];
}

/** Liang-Barsky on the open box; for axis-parallel segments the same as `hits`. */
export function cuts(seg: Seg, b: Box, shrink = 2): boolean {
  const [p, q] = seg;
  if (p.x === q.x || p.y === q.y) return hits(seg, b, shrink);
  const x0 = b.x + shrink;
  const x1 = b.x + b.width - shrink;
  const y0 = b.y + shrink;
  const y1 = b.y + b.height - shrink;
  if (x0 >= x1 || y0 >= y1) return false;
  const [ax, bx] = slab(p.x, q.x - p.x, x0, x1);
  const [ay, by] = slab(p.y, q.y - p.y, y0, y1);
  const lo = Math.max(ax, ay);
  const hi = Math.min(bx, by);
  return lo < hi && lo < 1 && hi > 0;
}

export const overlap = (a: Box, b: Box): boolean => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

export const inside = (a: Box, b: Box): boolean => a.x >= b.x && a.y >= b.y && a.x + a.width <= b.x + b.width && a.y + a.height <= b.y + b.height;

export const ptIn = (p: Point, b: Box): boolean => p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height;

/** ≤ 0: none */
export function collinear([a, b]: Seg, [c, d]: Seg): number {
  if (a.x === b.x && c.x === d.x && a.x === c.x) {
    return Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) - Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y));
  }
  if (a.y === b.y && c.y === d.y && a.y === c.y) {
    return Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) - Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x));
  }
  return 0;
}

export function glyph(lb: Box, name: string): Box {
  const est = Math.max(6, name.length * 6);
  const width = Math.min(est, 90);
  const lines = Math.max(1, Math.ceil(est / 90));
  return { x: cx(lb) - width / 2, y: lb.y, width, height: lines * 14 };
}

export const lookup = <T>(map: Map<string, T>, id: string | undefined): T | undefined => (id === undefined ? undefined : map.get(id));

export function boundsOf(bounds: unknown): Box | undefined {
  if (!bounds) return undefined;
  return {
    x: raw<number>(bounds, 'x')!,
    y: raw<number>(bounds, 'y')!,
    width: raw<number>(bounds, 'width')!,
    height: raw<number>(bounds, 'height')!,
  };
}

export interface MetricIndex {
  parentOf: Map<string, El>;
  laneOf: Map<string, El>;
  poolOf: Map<string, El>;
  /** only those of the laid-out processes */
  need: Set<string>;
  /** via sequence flows and host -> boundary event */
  next: Map<string, string[]>;
}

export function enclosingProcess(scope: El | undefined): El | undefined {
  let s: El | undefined = scope;
  while (s && !is(s, 'bpmn:Process')) s = s.$parent as El | undefined;
  return s;
}

export interface Shape {
  id: string;
  el: El;
  b: Box;
  container: boolean;
  expanded: boolean;
  label?: Box;
}

export interface Edge {
  id: string;
  el: El;
  pts: Point[];
  segs: Seg[];
  /** `undefined` is an unresolved end and makes edges related, as in the harness */
  ends: Set<string | undefined>;
  label?: Box;
}

function endsOf(el: El): Set<string | undefined> {
  const source = raw<unknown>(el, 'sourceRef');
  const ends = new Set<string | undefined>([idOf(source), idOf(raw(el, 'targetRef'))]);
  if (Array.isArray(source)) for (const s of source) ends.add(idOf(s));
  const parent = el.$parent;
  if (parent && is(parent, 'bpmn:FlowNode')) ends.add(idOf(parent));
  return ends;
}

export function readDrawnPlane(plane: unknown, seen: Set<string>): { shapes: Shape[]; edges: Edge[] } {
  const shapes: Shape[] = [];
  const edges: Edge[] = [];
  for (const pe of rawList(plane, 'planeElement')) {
    const el = raw<El>(pe, 'bpmnElement');
    const id = idOf(el);
    if (!el || !id) continue;
    seen.add(id);
    const label = boundsOf(raw(raw(pe, 'label'), 'bounds'));
    if (is(pe, 'bpmndi:BPMNShape')) {
      const b = boundsOf(raw(pe, 'bounds'));
      if (!b) continue;
      const expanded = !!raw<boolean>(pe, 'isExpanded');
      const container = (is(el, 'bpmn:SubProcess') && expanded) || is(el, 'bpmn:Participant') || is(el, 'bpmn:Lane');
      shapes.push({ id, el, b, container, expanded, ...(label ? { label } : {}) });
    } else if (is(pe, 'bpmndi:BPMNEdge')) {
      const pts = rawList(pe, 'waypoint').map((w) => ({ x: raw<number>(w, 'x')!, y: raw<number>(w, 'y')! }));
      edges.push({ id, el, pts, segs: segs(pts), ends: endsOf(el), ...(label ? { label } : {}) });
    }
  }
  return { shapes, edges };
}

/** A data association is drawn between its activity and the data object / store. */
export function drawnEnds(el: El): [string | undefined, string | undefined] {
  if (is(el, 'bpmn:DataInputAssociation')) return [idOf(rawList(el, 'sourceRef')[0]), idOf(el.$parent)];
  if (is(el, 'bpmn:DataOutputAssociation')) return [idOf(el.$parent), idOf(raw(el, 'targetRef'))];
  return [idOf(raw(el, 'sourceRef')), idOf(raw(el, 'targetRef'))];
}

interface Run {
  seg: Seg;
  idx: number[];
}

/** A zero-length segment joins the run before it; leading ones join the first run. */
function runs(list: Seg[]): Run[] {
  const out: Run[] = [];
  const way = ([p, q]: Seg): string => `${Math.sign(q.x - p.x)},${Math.sign(q.y - p.y)}`;
  const lead: number[] = [];
  list.forEach((s, k) => {
    const last = out[out.length - 1];
    const empty = s[0].x === s[1].x && s[0].y === s[1].y;
    const straight = s[0].x === s[1].x || s[0].y === s[1].y;
    if (!last && empty) lead.push(k);
    else if (last && (empty || (straight && way(last.seg) === way(s)))) {
      last.seg = [last.seg[0], s[1]];
      last.idx.push(k);
    } else out.push({ seg: s, idx: out.length ? [k] : [...lead, k] });
  });
  if (!out.length && lead.length) out.push({ seg: list[lead[0]!]!, idx: lead });
  return out;
}

/**
 * The common tail of two flows entering one gateway's top or bottom vertex vertically, back to
 * where they part. bpmn-js draws a join's entries sharing that vertex, so the tail is no merge.
 */
export function joinTail(a: Edge, b: Edge, target: Shape | undefined): Set<string> {
  const tail = new Set<string>();
  if (!target || !is(target.el, 'bpmn:Gateway')) return tail;
  const g = target.b;
  const near = (p: Point, q: Point): boolean => Math.abs(p.x - q.x) <= 2 && Math.abs(p.y - q.y) <= 2;
  // 1: enters the bottom vertex, -1: the top one, 0: neither
  const entry = (r: Run | undefined): number => {
    if (!r) return 0;
    const [p, q] = r.seg;
    if (p.x !== q.x || Math.abs(q.x - (cx(g))) > 2) return 0;
    if (Math.abs(q.y - (g.y + g.height)) <= 2 && p.y > q.y) return 1;
    return Math.abs(q.y - g.y) <= 2 && p.y < q.y ? -1 : 0;
  };
  const ra = runs(a.segs);
  const rb = runs(b.segs);
  const side = entry(ra[ra.length - 1]);
  if (!side || entry(rb[rb.length - 1]) !== side) return tail;
  for (let i = ra.length - 1, j = rb.length - 1; i >= 0 && j >= 0; i--, j--) {
    const x = ra[i]!;
    const y = rb[j]!;
    if (collinear(x.seg, y.seg) <= 0) break;
    for (const k of x.idx) for (const l of y.idx) tail.add(`${k},${l}`);
    if (!near(x.seg[0], y.seg[0])) break;
    // two flows drawn on top of each other from start to end are no join
    if (i === 0 && j === 0) return new Set();
  }
  return tail;
}

export const subTitleOf = (s: Shape): Box | undefined => (s.expanded && is(s.el, 'bpmn:SubProcess') ? titleBox(s.b, raw<string>(s.el, 'name')) : undefined);
