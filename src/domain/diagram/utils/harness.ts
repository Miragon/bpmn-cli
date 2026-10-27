import { cx } from './geom.js';
/**
 * Geometry and lenient DI reading of the layout metrics, matching the regression harness:
 * every shape and edge counts and bounds and waypoints are taken without a finite check.
 */
import { is, type El } from '../../document/utils/moddle.js';
import type { Box, Point } from '../di/types.js';
import { idOf, raw, rawList } from './raw.js';
import { titleBox } from './text.js';

export type Seg = [Point, Point];

export function segs(pts: Point[]): Seg[] {
  const out: Seg[] = [];
  for (let index = 0; index + 1 < pts.length; index++) out.push([pts[index]!, pts[index + 1]!]);
  return out;
}

export const hits = ([start, end]: Seg, box: Box, shrink = 2): boolean =>
  Math.min(start.x, end.x) < box.x + box.width - shrink &&
  Math.max(start.x, end.x) > box.x + shrink &&
  Math.min(start.y, end.y) < box.y + box.height - shrink &&
  Math.max(start.y, end.y) > box.y + shrink;

function slab(origin: number, direction: number, lo: number, hi: number): [number, number] {
  const lowExit = (lo - origin) / direction;
  const highExit = (hi - origin) / direction;
  return lowExit < highExit ? [lowExit, highExit] : [highExit, lowExit];
}

/** Liang-Barsky on the open box; for axis-parallel segments the same as `hits`. */
export function cuts(seg: Seg, box: Box, shrink = 2): boolean {
  const [start, end] = seg;
  if (start.x === end.x || start.y === end.y) return hits(seg, box, shrink);
  const x0 = box.x + shrink;
  const x1 = box.x + box.width - shrink;
  const y0 = box.y + shrink;
  const y1 = box.y + box.height - shrink;
  if (x0 >= x1 || y0 >= y1) return false;
  const [ax, bx] = slab(start.x, end.x - start.x, x0, x1);
  const [ay, by] = slab(start.y, end.y - start.y, y0, y1);
  const lo = Math.max(ax, ay);
  const hi = Math.min(bx, by);
  return lo < hi && lo < 1 && hi > 0;
}

export const overlap = (first: Box, second: Box): boolean => first.x < second.x + second.width && second.x < first.x + first.width && first.y < second.y + second.height && second.y < first.y + first.height;

export const inside = (inner: Box, outer: Box): boolean => inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;

export const ptIn = (point: Point, box: Box): boolean => point.x >= box.x && point.x <= box.x + box.width && point.y >= box.y && point.y <= box.y + box.height;

/** ≤ 0: none */
export function collinear([firstStart, firstEnd]: Seg, [secondStart, secondEnd]: Seg): number {
  if (firstStart.x === firstEnd.x && secondStart.x === secondEnd.x && firstStart.x === secondStart.x) {
    return Math.min(Math.max(firstStart.y, firstEnd.y), Math.max(secondStart.y, secondEnd.y)) - Math.max(Math.min(firstStart.y, firstEnd.y), Math.min(secondStart.y, secondEnd.y));
  }
  if (firstStart.y === firstEnd.y && secondStart.y === secondEnd.y && firstStart.y === secondStart.y) {
    return Math.min(Math.max(firstStart.x, firstEnd.x), Math.max(secondStart.x, secondEnd.x)) - Math.max(Math.min(firstStart.x, firstEnd.x), Math.min(secondStart.x, secondEnd.x));
  }
  return 0;
}

export function glyph(lb: Box, name: string): Box {
  const est = Math.max(6, name.length * 6);
  const width = Math.min(est, 90);
  const lines = Math.max(1, Math.ceil(est / 90));
  return { x: cx(lb) - width / 2, y: lb.y, width, height: lines * 14 };
}

export const lookup = <TValue>(map: Map<string, TValue>, id: string | undefined): TValue | undefined => (id === undefined ? undefined : map.get(id));

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
  let current: El | undefined = scope;
  while (current && !is(current, 'bpmn:Process')) current = current.$parent as El | undefined;
  return current;
}

export interface Shape {
  id: string;
  el: El;
  bounds: Box;
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
  if (Array.isArray(source)) for (const sourceElement of source) ends.add(idOf(sourceElement));
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
      const bounds = boundsOf(raw(pe, 'bounds'));
      if (!bounds) continue;
      const expanded = !!raw<boolean>(pe, 'isExpanded');
      const container = (is(el, 'bpmn:SubProcess') && expanded) || is(el, 'bpmn:Participant') || is(el, 'bpmn:Lane');
      shapes.push({ id, el, bounds, container, expanded, ...(label ? { label } : {}) });
    } else if (is(pe, 'bpmndi:BPMNEdge')) {
      const pts = rawList(pe, 'waypoint').map((waypoint) => ({ x: raw<number>(waypoint, 'x')!, y: raw<number>(waypoint, 'y')! }));
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
  const way = ([start, end]: Seg): string => `${Math.sign(end.x - start.x)},${Math.sign(end.y - start.y)}`;
  const lead: number[] = [];
  list.forEach((segment, segmentIndex) => {
    const last = out[out.length - 1];
    const empty = segment[0].x === segment[1].x && segment[0].y === segment[1].y;
    const straight = segment[0].x === segment[1].x || segment[0].y === segment[1].y;
    if (!last && empty) lead.push(segmentIndex);
    else if (last && (empty || (straight && way(last.seg) === way(segment)))) {
      last.seg = [last.seg[0], segment[1]];
      last.idx.push(segmentIndex);
    } else out.push({ seg: segment, idx: out.length ? [segmentIndex] : [...lead, segmentIndex] });
  });
  if (!out.length && lead.length) out.push({ seg: list[lead[0]!]!, idx: lead });
  return out;
}

/**
 * The common tail of two flows entering one gateway's top or bottom vertex vertically, back to
 * where they part. bpmn-js draws a join's entries sharing that vertex, so the tail is no merge.
 * Two flows drawn on top of each other from start to end are no join.
 */
export function joinTail(first: Edge, second: Edge, target: Shape | undefined): Set<string> {
  const tail = new Set<string>();
  if (!target || !is(target.el, 'bpmn:Gateway')) return tail;
  const targetBounds = target.bounds;
  const near = (here: Point, there: Point): boolean => Math.abs(here.x - there.x) <= 2 && Math.abs(here.y - there.y) <= 2;
  const entry = (run: Run | undefined): number => {
    if (!run) return 0;
    const [start, end] = run.seg;
    if (start.x !== end.x || Math.abs(end.x - (cx(targetBounds))) > 2) return 0;
    if (Math.abs(end.y - (targetBounds.y + targetBounds.height)) <= 2 && start.y > end.y) return 1;
    return Math.abs(end.y - targetBounds.y) <= 2 && start.y < end.y ? -1 : 0;
  };
  const ra = runs(first.segs);
  const rb = runs(second.segs);
  const side = entry(ra[ra.length - 1]);
  if (!side || entry(rb[rb.length - 1]) !== side) return tail;
  for (let firstIndex = ra.length - 1, secondIndex = rb.length - 1; firstIndex >= 0 && secondIndex >= 0; firstIndex--, secondIndex--) {
    const firstRun = ra[firstIndex]!;
    const secondRun = rb[secondIndex]!;
    if (collinear(firstRun.seg, secondRun.seg) <= 0) break;
    for (const firstSegmentIndex of firstRun.idx) for (const secondSegmentIndex of secondRun.idx) tail.add(`${firstSegmentIndex},${secondSegmentIndex}`);
    if (!near(firstRun.seg[0], secondRun.seg[0])) break;
    if (firstIndex === 0 && secondIndex === 0) return new Set();
  }
  return tail;
}

export const subTitleOf = (shape: Shape): Box | undefined => (shape.expanded && is(shape.el, 'bpmn:SubProcess') ? titleBox(shape.bounds, raw<string>(shape.el, 'name')) : undefined);
