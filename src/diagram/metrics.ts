/**
 * Layout quality metrics with element ids: a library port of `analyse()` in
 * tools/layout-regress.mjs.
 *
 * CONTRACT
 *  - layoutProblems(defs) inspects the DI of every BPMNDiagram of a moddle
 *    `bpmn:Definitions` element and returns `{ counts, problems, score }`.
 *    For the kinds of the regression harness (HARNESS_KEYS) it uses exactly
 *    the harness's metric definitions, de-duplication and weights: `counts[k]`
 *    equals the length of the harness's de-duplicated list for `k` (problems
 *    are de-duplicated by the harness's own key string). The harness stays
 *    independent of this module: change both together. `score = Σ counts[k] ·
 *    WEIGHTS[k]` over all KEYS.
 *  - EXTRA_KEYS are structural defects the harness does not measure (the
 *    clean engine never produces them); hard defects, weighted like an
 *    overlap:
 *      frameIntrusion  a shape (node, boundary event, artifact, expanded
 *                      sub-process) whose centre lies strictly inside an
 *                      expanded sub-process, pool or lane of its plane that
 *                      is not its home: a sub-process is home when it is a
 *                      semantic ancestor (or the host of a boundary event),
 *                      a pool when it holds the shape's process, a lane when
 *                      it (or a lane below it) lists the shape, its host or
 *                      an enclosing sub-process, or, when none of them is in
 *                      a lane, any lane of the shape's process. Frames inside
 *                      the shape itself and collaboration-level artifacts
 *                      (no process) are left out
 *      frameOverlap    two expanded sub-processes of one process, two lanes
 *                      of one process, or two pools, neither inside the other
 *                      semantically, overlapping by more than 1 px both ways
 *      degenerateEdge  a BPMNEdge with fewer than 2 waypoints or of zero
 *                      length
 *      detachedEdge    a BPMNEdge whose first or last waypoint lies more
 *                      than DETACHED_GAP (10) px outside the bounds of the
 *                      shape of that end on its plane (an end without a
 *                      shape there, or docked on a connection, is not
 *                      checked): a line left at its end's old place, which
 *                      the incremental layout reroutes (reroute.ts
 *                      detachedEnds, the same rule)
 *  - QUALITY_KEYS are soft drawing-quality kinds the harness does not
 *    measure either (weights below 6, so the bench and the fuzzer never count
 *    them as hard):
 *      backwardFlow      a sequence flow whose target's centre lies left of
 *                        its source's left border, unless the target reaches
 *                        the source again (a loop return); sequence flows and
 *                        boundary events (host -> event) form the graph
 *      segmentOverlap    two sequence flows into the same target running on
 *                        top of each other for more than 20 px (a shared
 *                        final segment: they merge before the target; a
 *                        common first segment of a fork does not count).
 *                        Into a gateway (any kind), the common tail of two
 *                        flows that both enter its bottom vertex, or both
 *                        its top vertex, on a vertical final segment does
 *                        not count either: a join's entries share that
 *                        vertex, as bpmn-js draws them. The tail runs from
 *                        the vertex back to where the two part (while
 *                        their runs are collinear and start at the same
 *                        point, 2 px tolerance); what they share elsewhere
 *                        counts, and so do a merge onto a line into a side
 *                        vertex and two flows drawn on top of each other
 *                        from start to end
 *      labelOutsideFrame the label of a named event, gateway, data object /
 *                        store or sequence flow reaching out of its home
 *                        frame: the expanded sub-process it lives in, else
 *                        the pool of its process (2 px tolerance)
 *      labelOnTitle      the label of a named event (boundary events
 *                        included), gateway, data object / store, sequence
 *                        or message flow overlapping the title of a named
 *                        expanded sub-process (event sub-processes,
 *                        transactions and ad-hoc ones too) on its plane:
 *                        where bpmn-js draws its name, text.ts titleBox.
 *                        Pool and lane names are not checked
 *      messageLabelFar   a named message flow whose label is more than 50 px
 *                        away from its line
 *  - `through` uses a real segment-rectangle test (an axis-parallel segment:
 *    the same as its bounding box); labelOnLine and msgThroughPool keep the
 *    harness's bounding-box test.
 *  - Leaf shapes (overlaps, through, label on shape) are every shape but
 *    pools, lanes, expanded sub-processes and groups: a group box is drawn
 *    around its members, so it overlaps them by design (the harness alike).
 *  - Every problem names the elements involved (`ids`), problems are listed in
 *    KEYS order and, within a kind, in the order the harness finds them:
 *      crossings      [edgeA, edgeB]           overlaps     [shapeA, shapeB]
 *      frameIntrusion [shape, frame]           frameOverlap [frameA, frameB]
 *      through        [edge, shape]            diagonal     [edge]
 *      degenerateEdge [edge]                   detachedEdge [edge, end shape(s) it does not reach]
 *      missing        [element]                labelClash   [labelOwner, shape | other labelOwner]
 *      labelOnLine    [labelOwner, edge]       inOut        [incoming, outgoing, node]
 *      parallelRun    [edgeA, edgeB]           outsideLane  [node, lane]
 *      outsidePool    [node, participant]      outsideSub   [node, subProcess]
 *      edgeLeavesLane [flow, lane]             edgeOutside  [flow, participant | subProcess]
 *      msgThroughPool [messageFlow, participant]
 *      laneGap        [lane, participant]      failed       []
 *      backwardFlow   [flow, source, target]   segmentOverlap [flowA, flowB, shared node]
 *      labelOutsideFrame [labelOwner, frame]   messageLabelFar [messageFlow]
 *      labelOnTitle   [labelOwner, subProcess]
 *    `detail` carries the label variant ('label on shape' | 'label on label'),
 *    the lane side ('top' | 'bottom'), the collinear length of a parallel run
 *    or a segment overlap ('35px'), the distance of a far message label
 *    ('80px') or the failure message.
 *  - `failed` only comes from import warnings, which layoutProblemsOfXml (or a
 *    caller passing `importWarnings`) reports; the harness additionally uses it
 *    for a crashed layout command.
 *  - locateProblems(defs, problems) adds where each problem shows (`at`;
 *    `bpmn render --problems` puts a numbered badge there): a point on the
 *    plane of the element `at.plane` names (the plane's bpmnElement),
 *    rounded to 2 decimals, found from the problem's kind, ids and detail
 *    with the same tests the checks use. It lies inside the bounding box of
 *    the problem's elements (shapes, waypoints, DI label bounds), on the
 *    defect itself:
 *      crossings      the crossing point          overlaps, frameOverlap  the centre of the overlap
 *      through, msgThroughPool  the middle of the segment's part inside the shape / pool
 *      diagonal       the middle of the first diagonal segment
 *      degenerateEdge its first waypoint (none without waypoints)
 *      detachedEdge   the end point of the first end it does not reach
 *      labelClash     the centre of the label's overlap with the shape / other label
 *      labelOnLine    the middle of the segment's part in the label text
 *      inOut, parallelRun, segmentOverlap  the middle of the first shared run
 *                     (of a segmentOverlap: the first one that counts, a
 *                     join's common tail skipped)
 *      frameIntrusion, outsideLane, outsidePool, outsideSub  the shape's centre
 *      edgeLeavesLane, edgeOutside  the first waypoint outside the frame
 *      laneGap        the middle of the gap between the lane and the pool border
 *      backwardFlow   half-way along the flow
 *      labelOutsideFrame, messageLabelFar  the centre of the label
 *      labelOnTitle   the centre of the label's overlap with the title
 *    `missing` and `failed` (and a problem whose elements are not drawn)
 *    get no `at`. It is a separate pass, so layoutProblems (every mutation
 *    runs it) and its output are unchanged: results and `metrics` never
 *    carry coordinates.
 *  - Read-only: model properties are read directly, never through `get()`,
 *    which would materialise empty collections on the model.
 *  - diffProblems(before, after) matches problems by problemKey: the kind, the
 *    ids (order-free for symmetric kinds) and the detail unless it is a
 *    measurement (parallelRun length). Duplicates are matched one to one.
 */
import { is, parseXml, type El } from '../model/utils/moddle.js';
import type { Box, Point } from './types.js';
import { titleBox } from './text.js';

/** structural defects the regression harness does not measure (see contract) */
export const EXTRA_KEYS = ['frameIntrusion', 'frameOverlap', 'degenerateEdge', 'detachedEdge'] as const;

/** soft drawing-quality kinds the regression harness does not measure (see contract) */
export const QUALITY_KEYS = ['backwardFlow', 'segmentOverlap', 'labelOutsideFrame', 'labelOnTitle', 'messageLabelFar'] as const;

export const KEYS = [
  'crossings',
  'overlaps',
  'frameIntrusion',
  'frameOverlap',
  'through',
  'diagonal',
  'degenerateEdge',
  'detachedEdge',
  'missing',
  'labelClash',
  'labelOnLine',
  'inOut',
  'parallelRun',
  'outsideLane',
  'outsidePool',
  'outsideSub',
  'edgeLeavesLane',
  'edgeOutside',
  'msgThroughPool',
  'laneGap',
  'backwardFlow',
  'segmentOverlap',
  'labelOutsideFrame',
  'labelOnTitle',
  'messageLabelFar',
  'failed',
] as const;

export type MetricKey = (typeof KEYS)[number];

/** the kinds of the regression harness (tools/layout-regress.mjs), in its order */
export const HARNESS_KEYS: readonly MetricKey[] = KEYS.filter((k) => !(EXTRA_KEYS as readonly string[]).includes(k) && !(QUALITY_KEYS as readonly string[]).includes(k));

export const WEIGHTS: Readonly<Record<MetricKey, number>> = {
  crossings: 5,
  overlaps: 10,
  frameIntrusion: 10,
  frameOverlap: 10,
  through: 8,
  diagonal: 3,
  degenerateEdge: 10,
  detachedEdge: 10,
  missing: 10,
  labelClash: 2,
  labelOnLine: 1,
  inOut: 3,
  parallelRun: 1,
  outsideLane: 6,
  outsidePool: 8,
  outsideSub: 8,
  edgeLeavesLane: 1,
  edgeOutside: 4,
  msgThroughPool: 5,
  laneGap: 2,
  backwardFlow: 3,
  segmentOverlap: 2,
  labelOutsideFrame: 2,
  labelOnTitle: 2,
  messageLabelFar: 1,
  failed: 50,
};

/** Where a problem shows in the drawing (locateProblems). */
export interface ProblemLocation {
  /** the element whose plane it is on: process, collaboration or collapsed sub-process */
  plane: string;
  x: number;
  y: number;
}

export interface LayoutProblem {
  kind: MetricKey;
  ids: string[];
  detail?: string;
  /** only from locateProblems: where it shows (see contract) */
  at?: ProblemLocation;
}

export interface LayoutMetrics {
  counts: Record<MetricKey, number>;
  problems: LayoutProblem[];
  score: number;
}

export interface MetricsSummary {
  counts: Record<MetricKey, number>;
  score: number;
}

/** The `layout.metrics` block of a mutation result. */
export interface MetricsDelta {
  before?: MetricsSummary;
  after: MetricsSummary;
  added: LayoutProblem[];
  resolved: LayoutProblem[];
}

/* ------------------------------------------------------------------ */
/* geometry (same semantics as the harness helpers)                     */
/* ------------------------------------------------------------------ */

type Seg = [Point, Point];

function segs(pts: Point[]): Seg[] {
  const out: Seg[] = [];
  for (let i = 0; i + 1 < pts.length; i++) out.push([pts[i]!, pts[i + 1]!]);
  return out;
}

const orient = (a: Point, b: Point, c: Point): number => Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));

/** proper crossing: the end points of each segment lie strictly on both sides of the other */
function cross([a, b]: Seg, [c, d]: Seg): boolean {
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  return o1 !== o2 && o3 !== o4 && !!o1 && !!o2 && !!o3 && !!o4;
}

/** segment bounding box meets the box shrunk by `shrink` */
const hits = ([p, q]: Seg, b: Box, shrink = 2): boolean =>
  Math.min(p.x, q.x) < b.x + b.width - shrink &&
  Math.max(p.x, q.x) > b.x + shrink &&
  Math.min(p.y, q.y) < b.y + b.height - shrink &&
  Math.max(p.y, q.y) > b.y + shrink;

/** parameter range (open) in which p + t·d lies strictly between lo and hi on one axis */
function slab(p: number, d: number, lo: number, hi: number): [number, number] {
  const a = (lo - p) / d;
  const b = (hi - p) / d;
  return a < b ? [a, b] : [b, a];
}

/**
 * The segment itself meets the box shrunk by `shrink` (Liang-Barsky on the
 * open box). Axis-parallel segments: exactly the bounding-box test `hits`.
 */
function cuts(seg: Seg, b: Box, shrink = 2): boolean {
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

const overlap = (a: Box, b: Box): boolean => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

const inside = (a: Box, b: Box): boolean => a.x >= b.x && a.y >= b.y && a.x + a.width <= b.x + b.width && a.y + a.height <= b.y + b.height;

const ptIn = (p: Point, b: Box): boolean => p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height;

/** length two segments share on one horizontal or vertical line (≤ 0: none) */
function collinear([a, b]: Seg, [c, d]: Seg): number {
  if (a.x === b.x && c.x === d.x && a.x === c.x) {
    return Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) - Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y));
  }
  if (a.y === b.y && c.y === d.y && a.y === c.y) {
    return Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) - Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x));
  }
  return 0;
}

/** estimated box of the label text inside its DI label bounds */
function glyph(lb: Box, name: string): Box {
  const est = Math.max(6, name.length * 6);
  const width = Math.min(est, 90);
  const lines = Math.max(1, Math.ceil(est / 90));
  return { x: lb.x + lb.width / 2 - width / 2, y: lb.y, width, height: lines * 14 };
}

/* ------------------------------------------------------------------ */
/* raw model access (no lazy collections)                               */
/* ------------------------------------------------------------------ */

function raw<T>(el: unknown, prop: string): T | undefined {
  return el && typeof el === 'object' ? ((el as Record<string, unknown>)[prop] as T | undefined) : undefined;
}

const elsOf = (el: unknown, prop: string): El[] => raw<El[]>(el, prop) ?? [];

const idOf = (el: unknown): string | undefined => raw<string>(el, 'id');

const lookup = <T>(map: Map<string, T>, id: string | undefined): T | undefined => (id === undefined ? undefined : map.get(id));

function boxOf(bounds: unknown): Box | undefined {
  if (!bounds) return undefined;
  return {
    x: raw<number>(bounds, 'x')!,
    y: raw<number>(bounds, 'y')!,
    width: raw<number>(bounds, 'width')!,
    height: raw<number>(bounds, 'height')!,
  };
}

/* ------------------------------------------------------------------ */
/* semantic side                                                        */
/* ------------------------------------------------------------------ */

interface Semantics {
  /** flow element / artifact id -> containing process or sub-process */
  parentOf: Map<string, El>;
  /** flow node id -> innermost lane listing it */
  laneOf: Map<string, El>;
  /** process id -> participant */
  poolOf: Map<string, El>;
  /** ids that need DI (only those of the laid-out processes) */
  need: Set<string>;
  /** flow node id -> the nodes it leads to (sequence flows, host -> boundary event) */
  next: Map<string, string[]>;
}

function collectLanes(lanes: El[], laneOf: Map<string, El>): void {
  for (const lane of lanes) {
    for (const node of elsOf(lane, 'flowNodeRef')) {
      const id = idOf(node);
      if (id) laneOf.set(id, lane);
    }
    const child = raw<El>(lane, 'childLaneSet');
    if (child) collectLanes(elsOf(child, 'lanes'), laneOf);
  }
}

function link(sem: Semantics, from: string | undefined, to: string | undefined): void {
  if (!from || !to) return;
  const list = sem.next.get(from);
  if (list) list.push(to);
  else sem.next.set(from, [to]);
}

function collectScope(scope: El, sem: Semantics): void {
  for (const fe of elsOf(scope, 'flowElements')) {
    const id = idOf(fe);
    if (id) {
      sem.parentOf.set(id, scope);
      const drawn = is(fe, 'bpmn:FlowNode') || is(fe, 'bpmn:SequenceFlow') || is(fe, 'bpmn:DataObjectReference') || is(fe, 'bpmn:DataStoreReference');
      if (drawn) sem.need.add(id);
    }
    if (is(fe, 'bpmn:SubProcess')) collectScope(fe, sem);
    if (is(fe, 'bpmn:SequenceFlow')) link(sem, idOf(raw(fe, 'sourceRef')), idOf(raw(fe, 'targetRef')));
    if (is(fe, 'bpmn:BoundaryEvent')) link(sem, idOf(raw(fe, 'attachedToRef')), id);
    for (const da of [...elsOf(fe, 'dataInputAssociations'), ...elsOf(fe, 'dataOutputAssociations')]) {
      const daId = idOf(da);
      if (daId) sem.need.add(daId);
    }
  }
  for (const a of elsOf(scope, 'artifacts')) {
    const id = idOf(a);
    if (!id) continue;
    sem.parentOf.set(id, scope);
    if (is(a, 'bpmn:TextAnnotation') || is(a, 'bpmn:Association')) sem.need.add(id);
  }
  for (const ls of elsOf(scope, 'laneSets')) collectLanes(elsOf(ls, 'lanes'), sem.laneOf);
}

function processOf(scope: El | undefined): El | undefined {
  let s: El | undefined = scope;
  while (s && !is(s, 'bpmn:Process')) s = s.$parent as El | undefined;
  return s;
}

/** only the laid-out root needs DI: further root processes are a documented limitation */
function dropUnlaidProcesses(roots: El[], sem: Semantics): void {
  const collab = roots.find((e) => is(e, 'bpmn:Collaboration'));
  const laid = new Set<string>();
  if (collab) {
    for (const p of elsOf(collab, 'participants')) {
      const id = idOf(raw<El>(p, 'processRef'));
      if (id) laid.add(id);
    }
  } else {
    const id = idOf(roots.find((e) => is(e, 'bpmn:Process')));
    if (id) laid.add(id);
  }
  for (const id of [...sem.need]) {
    const proc = processOf(sem.parentOf.get(id));
    if (proc && !laid.has(idOf(proc) ?? '')) sem.need.delete(id);
  }
}

function semantics(defs: El): Semantics {
  const sem: Semantics = { parentOf: new Map(), laneOf: new Map(), poolOf: new Map(), need: new Set(), next: new Map() };
  const roots = elsOf(defs, 'rootElements');
  for (const root of roots) {
    if (is(root, 'bpmn:Process')) collectScope(root, sem);
    if (is(root, 'bpmn:Collaboration')) {
      for (const p of elsOf(root, 'participants')) {
        const id = idOf(p);
        if (id) sem.need.add(id);
        const procId = idOf(raw<El>(p, 'processRef'));
        if (procId) sem.poolOf.set(procId, p);
      }
      for (const m of elsOf(root, 'messageFlows')) {
        const id = idOf(m);
        if (id) sem.need.add(id);
      }
    }
  }
  dropUnlaidProcesses(roots, sem);
  return sem;
}

/* ------------------------------------------------------------------ */
/* diagram side                                                         */
/* ------------------------------------------------------------------ */

interface Shape {
  id: string;
  el: El;
  b: Box;
  container: boolean;
  expanded: boolean;
  label?: Box;
}

interface Edge {
  id: string;
  el: El;
  pts: Point[];
  segs: Seg[];
  /** connected element ids; `undefined` stands for an unresolved end and makes edges related like in the harness */
  ends: Set<string | undefined>;
  label?: Box;
}

type Add = (kind: MetricKey, key: string, ids: string[], detail?: string) => void;

interface PlaneCtx {
  sem: Semantics;
  shapes: Shape[];
  edges: Edge[];
  leaf: Shape[];
  byId: Map<string, Shape>;
  pools: Shape[];
  add: Add;
}

function edgeEnds(el: El): Set<string | undefined> {
  const source = raw<unknown>(el, 'sourceRef');
  const ends = new Set<string | undefined>([idOf(source), idOf(raw(el, 'targetRef'))]);
  if (Array.isArray(source)) for (const s of source) ends.add(idOf(s));
  const parent = el.$parent;
  if (parent && is(parent, 'bpmn:FlowNode')) ends.add(idOf(parent));
  return ends;
}

function readPlane(plane: unknown, seen: Set<string>): { shapes: Shape[]; edges: Edge[] } {
  const shapes: Shape[] = [];
  const edges: Edge[] = [];
  for (const pe of elsOf(plane, 'planeElement')) {
    const el = raw<El>(pe, 'bpmnElement');
    const id = idOf(el);
    if (!el || !id) continue;
    seen.add(id);
    const label = boxOf(raw(raw(pe, 'label'), 'bounds'));
    if (is(pe, 'bpmndi:BPMNShape')) {
      const b = boxOf(raw(pe, 'bounds'));
      if (!b) continue;
      const expanded = !!raw<boolean>(pe, 'isExpanded');
      const container = (is(el, 'bpmn:SubProcess') && expanded) || is(el, 'bpmn:Participant') || is(el, 'bpmn:Lane');
      shapes.push({ id, el, b, container, expanded, ...(label ? { label } : {}) });
    } else if (is(pe, 'bpmndi:BPMNEdge')) {
      const pts = elsOf(pe, 'waypoint').map((w) => ({ x: raw<number>(w, 'x')!, y: raw<number>(w, 'y')! }));
      edges.push({ id, el, pts, segs: segs(pts), ends: edgeEnds(el), ...(label ? { label } : {}) });
    }
  }
  return { shapes, edges };
}

const hostOf = (el: El): string | undefined => idOf(raw(el, 'attachedToRef'));

function checkOverlaps({ leaf, add }: PlaneCtx): void {
  for (let i = 0; i < leaf.length; i++) {
    for (let j = i + 1; j < leaf.length; j++) {
      const a = leaf[i]!;
      const b = leaf[j]!;
      const attached = (is(a.el, 'bpmn:BoundaryEvent') && hostOf(a.el) === b.id) || (is(b.el, 'bpmn:BoundaryEvent') && hostOf(b.el) === a.id);
      if (!attached && overlap(a.b, b.b)) add('overlaps', `${a.id}~${b.id}`, [a.id, b.id]);
    }
  }
}

/** diagonal segments of flows, edge segments through shapes they do not connect */
function checkEdgeSegments({ edges, leaf, add }: PlaneCtx): void {
  for (const e of edges) {
    const flow = is(e.el, 'bpmn:SequenceFlow') || is(e.el, 'bpmn:MessageFlow');
    for (const s of e.segs) {
      if (flow && s[0].x !== s[1].x && s[0].y !== s[1].y) add('diagonal', e.id, [e.id]);
      for (const sh of leaf) {
        if (e.ends.has(sh.id)) continue;
        if (is(sh.el, 'bpmn:BoundaryEvent') && e.ends.has(hostOf(sh.el))) continue;
        if (cuts(s, sh.b)) add('through', `${e.id}->${sh.id}`, [e.id, sh.id]);
      }
    }
  }
}

/** crossings of any two edges, collinear runs of unrelated edges */
function checkEdgePairs({ edges, add }: PlaneCtx): void {
  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      const a = edges[i]!;
      const b = edges[j]!;
      if (a.segs.some((sa) => b.segs.some((sb) => cross(sa, sb)))) add('crossings', `${a.id}x${b.id}`, [a.id, b.id]);
      const related = [...a.ends].some((x) => b.ends.has(x));
      if (related) continue;
      let len = 0;
      for (const sa of a.segs) for (const sb of b.segs) len += Math.max(0, collinear(sa, sb));
      if (len > 20) add('parallelRun', `${a.id}=${b.id}(${len})`, [a.id, b.id], `${len}px`);
    }
  }
}

function checkLabels({ shapes, edges, leaf, add }: PlaneCtx): void {
  const labels: Array<{ owner: string; box: Box; text: Box }> = [];
  for (const o of [...shapes, ...edges]) {
    if (o.label) labels.push({ owner: o.id, box: o.label, text: glyph(o.label, raw<string>(o.el, 'name') || '') });
  }
  for (let i = 0; i < labels.length; i++) {
    const l = labels[i]!;
    for (const s of leaf) {
      if (s.id !== l.owner && overlap(l.box, s.b)) add('labelClash', `${l.owner}#L~${s.id}`, [l.owner, s.id], 'label on shape');
    }
    for (let j = i + 1; j < labels.length; j++) {
      const other = labels[j]!;
      if (overlap(l.box, other.box)) add('labelClash', `${l.owner}#L~${other.owner}#L`, [l.owner, other.owner], 'label on label');
    }
    for (const e of edges) if (e.segs.some((s) => hits(s, l.text, 0))) add('labelOnLine', `${l.owner}#L~${e.id}`, [l.owner, e.id]);
  }
}

/** an incoming and an outgoing sequence flow of one node sharing a line */
function checkInOut({ shapes, edges, add }: PlaneCtx): void {
  const flows = edges.filter((e) => is(e.el, 'bpmn:SequenceFlow'));
  for (const s of shapes) {
    const into = flows.filter((e) => idOf(raw(e.el, 'targetRef')) === s.id);
    const outOf = flows.filter((e) => idOf(raw(e.el, 'sourceRef')) === s.id);
    for (const i of into) {
      for (const o of outOf) {
        if (i !== o && i.segs.some((a) => o.segs.some((b) => collinear(a, b) > 0))) add('inOut', `${i.id}|${o.id}@${s.id}`, [i.id, o.id, s.id]);
      }
    }
  }
}

/** nodes outside their expanded sub-process, lane or pool */
function checkContainment({ sem, shapes, byId, add }: PlaneCtx): void {
  for (const s of shapes) {
    if (is(s.el, 'bpmn:Participant') || is(s.el, 'bpmn:Lane')) continue;
    const parent = sem.parentOf.get(s.id);
    if (parent && is(parent, 'bpmn:SubProcess')) {
      const sub = lookup(byId, idOf(parent));
      if (sub?.expanded && !inside(s.b, sub.b)) add('outsideSub', s.id, [s.id, sub.id]);
    }
    const lane = lookup(byId, idOf(sem.laneOf.get(s.id)));
    if (lane && !is(s.el, 'bpmn:BoundaryEvent') && !inside(s.b, lane.b)) add('outsideLane', s.id, [s.id, lane.id]);
    const participant = parent && is(parent, 'bpmn:Process') ? lookup(sem.poolOf, idOf(parent)) : undefined;
    const pool = lookup(byId, idOf(participant));
    if (pool && !inside(s.b, pool.b)) add('outsidePool', s.id, [s.id, pool.id]);
  }
}

/** top-level lanes not reaching the top / bottom border of their pool */
function checkLaneGaps({ pools, byId, add }: PlaneCtx): void {
  for (const p of pools) {
    const proc = raw<El>(p.el, 'processRef');
    if (!proc) continue;
    for (const ls of elsOf(proc, 'laneSets')) {
      const top = elsOf(ls, 'lanes');
      const firstId = idOf(top[0]);
      const lastId = idOf(top[top.length - 1]);
      const first = lookup(byId, firstId);
      const last = lookup(byId, lastId);
      if (first && Math.abs(first.b.y - p.b.y) > 1) add('laneGap', `${first.id}:top`, [first.id, p.id], 'top');
      if (last && Math.abs(last.b.y + last.b.height - (p.b.y + p.b.height)) > 1) add('laneGap', `${last.id}:bottom`, [last.id, p.id], 'bottom');
    }
  }
}

/** frame of a sequence flow: its expanded sub-process or its pool */
function flowFrame({ sem, byId }: PlaneCtx, flowId: string): Shape | undefined {
  const parent = sem.parentOf.get(flowId);
  if (!parent) return undefined;
  if (is(parent, 'bpmn:SubProcess')) {
    const sub = lookup(byId, idOf(parent));
    return sub?.expanded ? sub : undefined;
  }
  return lookup(byId, idOf(lookup(sem.poolOf, idOf(parent))));
}

function checkSequenceFlow(ctx: PlaneCtx, e: Edge): void {
  const { sem, byId, add } = ctx;
  const frame = flowFrame(ctx, e.id);
  if (frame && e.pts.some((p) => !ptIn(p, frame.b))) add('edgeOutside', e.id, [e.id, frame.id]);
  const sl = lookup(sem.laneOf, idOf(raw(e.el, 'sourceRef')));
  const tl = lookup(sem.laneOf, idOf(raw(e.el, 'targetRef')));
  const lane = sl && sl === tl ? lookup(byId, idOf(sl)) : undefined;
  if (lane && e.pts.some((p) => !ptIn(p, lane.b))) add('edgeLeavesLane', e.id, [e.id, lane.id]);
}

function checkMessageFlow({ sem, pools, add }: PlaneCtx, e: Edge): void {
  const ends = new Set<string | undefined>([idOf(raw(e.el, 'sourceRef')), idOf(raw(e.el, 'targetRef'))]);
  for (const id of [...ends]) {
    const proc = processOf(lookup(sem.parentOf, id));
    const participant = lookup(sem.poolOf, idOf(proc));
    if (participant) ends.add(idOf(participant));
  }
  for (const s of e.segs) {
    for (const p of pools) if (!ends.has(p.id) && hits(s, p.b)) add('msgThroughPool', `${e.id}->${p.id}`, [e.id, p.id]);
  }
}

function checkFlows(ctx: PlaneCtx): void {
  for (const e of ctx.edges) {
    if (is(e.el, 'bpmn:SequenceFlow')) checkSequenceFlow(ctx, e);
    if (is(e.el, 'bpmn:MessageFlow')) checkMessageFlow(ctx, e);
  }
}

/* ------------------------------------------------------------------ */
/* frames (EXTRA_KEYS)                                                   */
/* ------------------------------------------------------------------ */

const isSub = (el: El): boolean => is(el, 'bpmn:SubProcess');
const isScope = (el: El): boolean => isSub(el) || is(el, 'bpmn:Process');

/** The process / sub-process scopes around an element, innermost first (its semantic `$parent` chain). */
function scopesOf(el: El): El[] {
  const out: El[] = [];
  let cur = el.$parent as El | undefined;
  for (let i = 0; cur && i < 50; i++) {
    if (isScope(cur)) out.push(cur);
    if (is(cur, 'bpmn:Process')) break;
    cur = cur.$parent as El | undefined;
  }
  return out;
}

/** A lane and the lanes it is nested in. */
function laneChain(lane: El): El[] {
  const out: El[] = [];
  let cur: El | undefined = lane;
  for (let i = 0; cur && i < 50; i++) {
    if (is(cur, 'bpmn:Lane')) out.push(cur);
    if (is(cur, 'bpmn:Process')) break;
    cur = cur.$parent as El | undefined;
  }
  return out;
}

/** The process a lane belongs to. */
function laneProcess(lane: El): El | undefined {
  let cur = lane.$parent as El | undefined;
  for (let i = 0; cur && !is(cur, 'bpmn:Process') && i < 50; i++) cur = cur.$parent as El | undefined;
  return cur;
}

/** Where a shape belongs (see contract, frameIntrusion); undefined: it belongs nowhere in particular. */
interface Home {
  el: El;
  scopes: El[];
  host?: El;
  process: El;
}

function homeOf(s: Shape): Home | undefined {
  if (is(s.el, 'bpmn:Participant') || is(s.el, 'bpmn:Lane') || is(s.el, 'bpmn:Group')) return undefined;
  const scopes = scopesOf(s.el);
  const process = scopes[scopes.length - 1];
  if (!process || !is(process, 'bpmn:Process')) return undefined;
  const host = raw<El>(s.el, 'attachedToRef');
  return { el: s.el, scopes, process, ...(host ? { host } : {}) };
}

function laneIsHome(sem: Semantics, h: Home, lane: El): boolean {
  let listed = false;
  for (const x of [h.el, h.host, ...h.scopes.filter(isSub)]) {
    const own = lookup(sem.laneOf, idOf(x));
    if (!own) continue;
    listed = true;
    if (laneChain(own).includes(lane)) return true;
  }
  return !listed && laneProcess(lane) === h.process;
}

function frameIsHome(sem: Semantics, h: Home, frame: Shape): boolean {
  if (is(frame.el, 'bpmn:Participant')) return raw<El>(frame.el, 'processRef') === h.process;
  if (is(frame.el, 'bpmn:Lane')) return laneIsHome(sem, h, frame.el);
  return frame.el === h.host || h.scopes.includes(frame.el) || (!!h.host && scopesOf(h.host).includes(frame.el));
}

const centreInside = (b: Box, f: Box): boolean => {
  const c = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  return c.x > f.x && c.x < f.x + f.width && c.y > f.y && c.y < f.y + f.height;
};

/** shapes whose centre lies in a frame that is not theirs */
function checkIntrusions({ sem, shapes, add }: PlaneCtx): void {
  const frames = shapes.filter((f) => f.container);
  for (const s of shapes) {
    const home = homeOf(s);
    if (!home) continue;
    for (const f of frames) {
      if (f === s || !centreInside(s.b, f.b) || frameIsHome(sem, home, f)) continue;
      if (scopesOf(f.el).includes(s.el)) continue; // a frame inside the shape itself
      add('frameIntrusion', `${s.id}@${f.id}`, [s.id, f.id]);
    }
  }
}

/** the scope a frame is compared within: pools all together, lanes and sub-processes per process */
function frameFamily(f: Shape): string | undefined {
  if (is(f.el, 'bpmn:Participant')) return 'pools';
  const proc = is(f.el, 'bpmn:Lane') ? laneProcess(f.el) : scopesOf(f.el).find((x) => is(x, 'bpmn:Process'));
  return proc ? `${is(f.el, 'bpmn:Lane') ? 'lanes' : 'subs'}:${idOf(proc) ?? ''}` : undefined;
}

function nestedFrames(a: Shape, b: Shape): boolean {
  if (is(a.el, 'bpmn:Lane')) return laneChain(a.el).includes(b.el) || laneChain(b.el).includes(a.el);
  return scopesOf(a.el).includes(b.el) || scopesOf(b.el).includes(a.el);
}

/** two frames of one family overlapping, neither inside the other */
function checkFrameOverlaps({ shapes, add }: PlaneCtx): void {
  const frames = shapes.filter((f) => f.container).map((f) => ({ f, family: frameFamily(f) }));
  for (let i = 0; i < frames.length; i++) {
    for (let j = i + 1; j < frames.length; j++) {
      const { f: a, family } = frames[i]!;
      const b = frames[j]!.f;
      if (!family || family !== frames[j]!.family || nestedFrames(a, b)) continue;
      const w = Math.min(a.b.x + a.b.width, b.b.x + b.b.width) - Math.max(a.b.x, b.b.x);
      const h = Math.min(a.b.y + a.b.height, b.b.y + b.b.height) - Math.max(a.b.y, b.b.y);
      if (w > 1 && h > 1) add('frameOverlap', `${a.id}&${b.id}`, [a.id, b.id]);
    }
  }
}

/** connections with fewer than two waypoints or of zero length */
function checkDegenerate({ edges, add }: PlaneCtx): void {
  for (const e of edges) {
    const length = e.segs.reduce((sum, [p, q]) => sum + Math.abs(q.x - p.x) + Math.abs(q.y - p.y), 0);
    if (e.pts.length < 2 || !(length > 0)) add('degenerateEdge', e.id, [e.id]);
  }
}

/** how far (px) an edge's end point may lie outside its end's shape (reroute.ts DETACHED_GAP alike) */
const DETACHED_GAP = 10;

/** The source and target an edge is drawn between (a data association: its activity and the data object / store). */
function drawnEnds(el: El): [string | undefined, string | undefined] {
  if (is(el, 'bpmn:DataInputAssociation')) return [idOf(elsOf(el, 'sourceRef')[0]), idOf(el.$parent)];
  if (is(el, 'bpmn:DataOutputAssociation')) return [idOf(el.$parent), idOf(raw(el, 'targetRef'))];
  return [idOf(raw(el, 'sourceRef')), idOf(raw(el, 'targetRef'))];
}

/** edges whose first or last waypoint lies far outside the shape of that end on the plane */
function checkDetached({ edges, byId, add }: PlaneCtx): void {
  for (const e of edges) {
    if (e.pts.length < 2) continue;
    const [sid, tid] = drawnEnds(e.el);
    const missed: string[] = [];
    for (const [id, p] of [
      [sid, e.pts[0]!],
      [tid, e.pts[e.pts.length - 1]!],
    ] as const) {
      const s = lookup(byId, id);
      if (s && (p.x < s.b.x - DETACHED_GAP || p.x > s.b.x + s.b.width + DETACHED_GAP || p.y < s.b.y - DETACHED_GAP || p.y > s.b.y + s.b.height + DETACHED_GAP)) missed.push(s.id);
    }
    if (missed.length) add('detachedEdge', e.id, [e.id, ...missed]);
  }
}

/* ------------------------------------------------------------------ */
/* drawing quality (QUALITY_KEYS)                                       */
/* ------------------------------------------------------------------ */

/** `to` is reachable from `from` along sequence flows (and host -> boundary event). */
function reaches(sem: Semantics, from: string, to: string): boolean {
  const seen = new Set<string>([from]);
  const stack = [from];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === to) return true;
    for (const n of sem.next.get(cur) ?? []) {
      if (seen.has(n)) continue;
      seen.add(n);
      stack.push(n);
    }
  }
  return false;
}

/** sequence flows running backwards (target left of the source) that are not loop returns */
function checkBackwardFlows({ sem, edges, byId, add }: PlaneCtx): void {
  for (const e of edges) {
    if (!is(e.el, 'bpmn:SequenceFlow')) continue;
    const sid = idOf(raw(e.el, 'sourceRef'));
    const tid = idOf(raw(e.el, 'targetRef'));
    const s = lookup(byId, sid);
    const t = lookup(byId, tid);
    if (!s || !t || !sid || !tid) continue;
    if (t.b.x + t.b.width / 2 >= s.b.x) continue;
    if (reaches(sem, tid, sid)) continue;
    add('backwardFlow', e.id, [e.id, sid, tid]);
  }
}

/** consecutive segments of a polyline going one way on one line, with their indices */
interface Run {
  seg: Seg;
  idx: number[];
}

/** the runs of a polyline (a zero-length segment joins the run before it; leading ones join the first run) */
function runs(list: Seg[]): Run[] {
  const out: Run[] = [];
  const way = ([p, q]: Seg): string => `${Math.sign(q.x - p.x)},${Math.sign(q.y - p.y)}`;
  // zero-length segments before the first run (a duplicate first waypoint)
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
 * The common tail of two sequence flows into one gateway that both enter it
 * through its bottom vertex (or both through its top vertex) on a vertical
 * final segment: the pairs of their segments (`i,j`, indices into a.segs and
 * b.segs) from that vertex back to where the flows part. A join's entries
 * share the vertex (bpmn-js draws them so), so this run is no merge. Empty
 * for any other target or end, and for two flows that never part.
 */
function joinTail(a: Edge, b: Edge, target: Shape | undefined): Set<string> {
  const tail = new Set<string>();
  if (!target || !is(target.el, 'bpmn:Gateway')) return tail;
  const g = target.b;
  const near = (p: Point, q: Point): boolean => Math.abs(p.x - q.x) <= 2 && Math.abs(p.y - q.y) <= 2;
  // the vertex a last run enters vertically from outside: 1 the bottom one, -1 the top one, 0 none
  const entry = (r: Run | undefined): number => {
    if (!r) return 0;
    const [p, q] = r.seg;
    if (p.x !== q.x || Math.abs(q.x - (g.x + g.width / 2)) > 2) return 0;
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
    // one line from start to end: two flows drawn on top of each other, not a join
    if (i === 0 && j === 0) return new Set();
  }
  return tail;
}

/**
 * two sequence flows into one target sharing a line for more than 20 px (they
 * merge before the target; flows leaving one source on a common first
 * segment are the usual fork and do not count, nor do a join's entries on
 * their common way into the gateway's bottom / top vertex: joinTail)
 */
function checkSegmentOverlaps({ edges, byId, add }: PlaneCtx): void {
  const byTarget = new Map<string, Edge[]>();
  for (const e of edges) {
    const target = is(e.el, 'bpmn:SequenceFlow') ? idOf(raw(e.el, 'targetRef')) : undefined;
    if (!target) continue;
    const list = byTarget.get(target);
    if (list) list.push(e);
    else byTarget.set(target, [e]);
  }
  for (const [target, list] of byTarget) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]!;
        const b = list[j]!;
        const tail = joinTail(a, b, byId.get(target));
        let len = 0;
        for (const [k, sa] of a.segs.entries()) for (const [l, sb] of b.segs.entries()) if (!tail.has(`${k},${l}`)) len += Math.max(0, collinear(sa, sb));
        if (len > 20) add('segmentOverlap', `${a.id}=${b.id}`, [a.id, b.id, target], `${len}px`);
      }
    }
  }
}

const externallyLabelled = (el: El): boolean => is(el, 'bpmn:Event') || is(el, 'bpmn:Gateway') || is(el, 'bpmn:DataObjectReference') || is(el, 'bpmn:DataStoreReference');

/** The frame a node's or flow's label belongs in: its expanded sub-process, else the pool of its process. */
function labelHome({ sem, byId }: PlaneCtx, id: string): Shape | undefined {
  const parent = sem.parentOf.get(id);
  if (!parent) return undefined;
  if (is(parent, 'bpmn:SubProcess')) {
    const sub = lookup(byId, idOf(parent));
    if (sub?.expanded) return sub;
  }
  return lookup(byId, idOf(lookup(sem.poolOf, idOf(processOf(parent)))));
}

/** named labels reaching out of their sub-process / pool */
function checkLabelFrames(ctx: PlaneCtx): void {
  const owners: Array<{ id: string; el: El; label?: Box }> = [...ctx.shapes.filter((s) => externallyLabelled(s.el)), ...ctx.edges.filter((e) => is(e.el, 'bpmn:SequenceFlow'))];
  for (const o of owners) {
    if (!o.label || !raw<string>(o.el, 'name')?.trim()) continue;
    const frame = labelHome(ctx, o.id);
    if (!frame || inside(o.label, { x: frame.b.x - 2, y: frame.b.y - 2, width: frame.b.width + 4, height: frame.b.height + 4 })) continue;
    ctx.add('labelOutsideFrame', `${o.id}#L@${frame.id}`, [o.id, frame.id]);
  }
}

/** The title of a named expanded sub-process (text.ts titleBox), undefined for any other shape. */
const titleOf = (s: Shape): Box | undefined => (s.expanded && is(s.el, 'bpmn:SubProcess') ? titleBox(s.b, raw<string>(s.el, 'name')) : undefined);

/** named external labels on the title of an expanded sub-process */
function checkLabelTitles({ shapes, edges, add }: PlaneCtx): void {
  const titles = shapes.flatMap((s) => {
    const box = titleOf(s);
    return box ? [{ id: s.id, box }] : [];
  });
  if (!titles.length) return;
  const owners: Array<{ id: string; el: El; label?: Box }> = [...shapes.filter((s) => externallyLabelled(s.el)), ...edges.filter((e) => is(e.el, 'bpmn:SequenceFlow') || is(e.el, 'bpmn:MessageFlow'))];
  for (const o of owners) {
    if (!o.label || !raw<string>(o.el, 'name')?.trim()) continue;
    for (const t of titles) if (overlap(o.label, t.box)) add('labelOnTitle', `${o.id}#L^${t.id}`, [o.id, t.id]);
  }
}

/** distance between a segment and a box (0 when they touch) */
function segmentBoxDistance([p, q]: Seg, b: Box): number {
  if (ptIn(p, b) || ptIn(q, b) || cuts([p, q], b, 0)) return 0;
  const pointBox = (r: Point): number => Math.hypot(Math.max(b.x - r.x, 0, r.x - b.x - b.width), Math.max(b.y - r.y, 0, r.y - b.y - b.height));
  const pointSeg = (r: Point): number => {
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const len = dx * dx + dy * dy;
    const t = len ? Math.max(0, Math.min(1, ((r.x - p.x) * dx + (r.y - p.y) * dy) / len)) : 0;
    return Math.hypot(r.x - (p.x + t * dx), r.y - (p.y + t * dy));
  };
  const corners: Point[] = [
    { x: b.x, y: b.y },
    { x: b.x + b.width, y: b.y },
    { x: b.x, y: b.y + b.height },
    { x: b.x + b.width, y: b.y + b.height },
  ];
  return Math.min(pointBox(p), pointBox(q), ...corners.map(pointSeg));
}

/** named message flows whose label is far from their line */
function checkMessageLabels({ edges, add }: PlaneCtx): void {
  for (const e of edges) {
    const label = e.label;
    if (!is(e.el, 'bpmn:MessageFlow') || !label || !e.segs.length || !raw<string>(e.el, 'name')?.trim()) continue;
    const d = Math.min(...e.segs.map((s) => segmentBoxDistance(s, label)));
    if (d > 50) add('messageLabelFar', e.id, [e.id], `${Math.round(d)}px`);
  }
}

function analysePlane(plane: unknown, sem: Semantics, seen: Set<string>, add: Add): void {
  const { shapes, edges } = readPlane(plane, seen);
  const ctx: PlaneCtx = {
    sem,
    shapes,
    edges,
    // a group is a frame drawn around its members: never an overlap, a line through it or a label on it
    leaf: shapes.filter((s) => !s.container && !is(s.el, 'bpmn:Group')),
    byId: new Map(shapes.map((s) => [s.id, s])),
    pools: shapes.filter((s) => is(s.el, 'bpmn:Participant')),
    add,
  };
  checkOverlaps(ctx);
  checkEdgeSegments(ctx);
  checkEdgePairs(ctx);
  checkLabels(ctx);
  checkInOut(ctx);
  checkContainment(ctx);
  checkLaneGaps(ctx);
  checkFlows(ctx);
  checkIntrusions(ctx);
  checkFrameOverlaps(ctx);
  checkDegenerate(ctx);
  checkDetached(ctx);
  checkBackwardFlows(ctx);
  checkSegmentOverlaps(ctx);
  checkLabelFrames(ctx);
  checkLabelTitles(ctx);
  checkMessageLabels(ctx);
}

/* ------------------------------------------------------------------ */
/* public API                                                           */
/* ------------------------------------------------------------------ */

function perKey<T>(make: () => T): Record<MetricKey, T> {
  return Object.fromEntries(KEYS.map((k) => [k, make()])) as Record<MetricKey, T>;
}

export function scoreOf(counts: Record<MetricKey, number>): number {
  return KEYS.reduce((sum, k) => sum + counts[k] * WEIGHTS[k], 0);
}

/**
 * Layout problems of all diagrams of `defs`. `importWarnings` (the number of
 * warnings of the XML import) is reported as one `failed` problem.
 */
export function layoutProblems(defs: El, opts: { importWarnings?: number } = {}): LayoutMetrics {
  const keys = perKey(() => new Set<string>());
  const found = perKey<LayoutProblem[]>(() => []);
  const add: Add = (kind, key, ids, detail) => {
    if (keys[kind].has(key)) return;
    keys[kind].add(key);
    found[kind].push(detail === undefined ? { kind, ids } : { kind, ids, detail });
  };
  if (opts.importWarnings) {
    const message = `import warnings: ${opts.importWarnings}`;
    add('failed', message, [], message);
  }
  const sem = semantics(defs);
  const seen = new Set<string>();
  for (const diagram of elsOf(defs, 'diagrams')) analysePlane(raw(diagram, 'plane'), sem, seen, add);
  for (const id of sem.need) if (!seen.has(id)) add('missing', id, [id]);
  const counts = perKey(() => 0);
  for (const k of KEYS) counts[k] = found[k].length;
  return { counts, problems: KEYS.flatMap((k) => found[k]), score: scoreOf(counts) };
}

/* ------------------------------------------------------------------ */
/* where a problem shows (locateProblems)                               */
/* ------------------------------------------------------------------ */

const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

const centreOf = (b: Box): Point => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

/** the centre of the common part of two boxes (of the first box when they do not meet) */
function meetCentre(a: Box, b: Box): Point {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const w = Math.min(a.x + a.width, b.x + b.width) - x;
  const h = Math.min(a.y + a.height, b.y + b.height) - y;
  return w >= 0 && h >= 0 ? { x: x + w / 2, y: y + h / 2 } : centreOf(a);
}

/** the crossing point of two properly crossing segments */
function crossPoint([a, b]: Seg, [c, d]: Seg): Point {
  const den = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x);
  const t = den ? ((c.x - a.x) * (d.y - c.y) - (c.y - a.y) * (d.x - c.x)) / den : 0.5;
  return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
}

/** the middle of the part of a segment inside the box shrunk by `shrink` (a bounding-box hit: the centre of the segment's box inside it) */
function clipMiddle(seg: Seg, b: Box, shrink: number): Point {
  const [p, q] = seg;
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  let lo = 0;
  let hi = 1;
  for (const [d, start, min, max] of [
    [dx, p.x, b.x + shrink, b.x + b.width - shrink],
    [dy, p.y, b.y + shrink, b.y + b.height - shrink],
  ] as const) {
    if (d === 0) {
      if (start < min || start > max) hi = -1;
      continue;
    }
    const t0 = (min - start) / d;
    const t1 = (max - start) / d;
    lo = Math.max(lo, Math.min(t0, t1));
    hi = Math.min(hi, Math.max(t0, t1));
  }
  if (lo <= hi) return { x: p.x + ((lo + hi) / 2) * dx, y: p.y + ((lo + hi) / 2) * dy };
  return meetCentre({ x: Math.min(p.x, q.x), y: Math.min(p.y, q.y), width: Math.abs(dx), height: Math.abs(dy) }, b);
}

/** the middle of the first run two edges share on one line, skipping the segment pairs in `skip` (`i,j`) */
function sharedAt(a: Edge, b: Edge, skip = new Set<string>()): Point | undefined {
  for (const [i, [p, q]] of a.segs.entries()) {
    for (const [j, [r, t]] of b.segs.entries()) {
      if (skip.has(`${i},${j}`) || collinear([p, q], [r, t]) <= 0) continue;
      if (p.x === q.x) return { x: p.x, y: (Math.max(Math.min(p.y, q.y), Math.min(r.y, t.y)) + Math.min(Math.max(p.y, q.y), Math.max(r.y, t.y))) / 2 };
      return { x: (Math.max(Math.min(p.x, q.x), Math.min(r.x, t.x)) + Math.min(Math.max(p.x, q.x), Math.max(r.x, t.x))) / 2, y: p.y };
    }
  }
  return undefined;
}

/** the point half-way along a polyline */
function halfway(pts: Point[]): Point | undefined {
  const parts = segs(pts);
  let rest = parts.reduce((sum, [p, q]) => sum + Math.hypot(q.x - p.x, q.y - p.y), 0) / 2;
  for (const [p, q] of parts) {
    const len = Math.hypot(q.x - p.x, q.y - p.y);
    if (len >= rest && len > 0) return { x: p.x + ((q.x - p.x) * rest) / len, y: p.y + ((q.y - p.y) * rest) / len };
    rest -= len;
  }
  return pts[0];
}

interface LocPlane {
  root: string;
  shapes: Map<string, Shape>;
  edges: Map<string, Edge>;
}

/** Where one problem shows on its plane (see contract). */
function locate(p: LayoutProblem, pl: LocPlane): Point | undefined {
  const [a, b] = p.ids;
  const sa = a === undefined ? undefined : pl.shapes.get(a);
  const sb = b === undefined ? undefined : pl.shapes.get(b);
  const ea = a === undefined ? undefined : pl.edges.get(a);
  const eb = b === undefined ? undefined : pl.edges.get(b);
  const labelOf = (id: string | undefined): Box | undefined => (id === undefined ? undefined : (pl.shapes.get(id)?.label ?? pl.edges.get(id)?.label));
  switch (p.kind) {
    case 'crossings':
      for (const x of ea?.segs ?? []) for (const y of eb?.segs ?? []) if (cross(x, y)) return crossPoint(x, y);
      return undefined;
    case 'overlaps':
    case 'frameOverlap':
      return sa && sb ? meetCentre(sa.b, sb.b) : undefined;
    case 'frameIntrusion':
    case 'outsideLane':
    case 'outsidePool':
    case 'outsideSub':
      return sa ? centreOf(sa.b) : undefined;
    case 'through': {
      const seg = sb ? ea?.segs.find((s) => cuts(s, sb.b)) : undefined;
      return seg && sb ? clipMiddle(seg, sb.b, 2) : undefined;
    }
    case 'msgThroughPool': {
      const seg = sb ? ea?.segs.find((s) => hits(s, sb.b)) : undefined;
      return seg && sb ? clipMiddle(seg, sb.b, 2) : undefined;
    }
    case 'diagonal': {
      const seg = ea?.segs.find(([q, r]) => q.x !== r.x && q.y !== r.y);
      return seg ? midpoint(seg[0], seg[1]) : undefined;
    }
    case 'degenerateEdge':
      return ea?.pts[0];
    case 'detachedEdge': {
      // the first end it does not reach: the source's when that is it, else the target's
      if (!ea || ea.pts.length < 2) return undefined;
      return drawnEnds(ea.el)[0] === b ? ea.pts[0] : ea.pts[ea.pts.length - 1];
    }
    case 'labelClash': {
      const own = labelOf(a);
      const other = p.detail === 'label on label' ? labelOf(b) : sb?.b;
      return own && other ? meetCentre(own, other) : undefined;
    }
    case 'labelOnLine': {
      const own = labelOf(a);
      const owner = sa ?? ea;
      if (!own || !owner) return undefined;
      const text = glyph(own, raw<string>(owner.el, 'name') || '');
      const seg = eb?.segs.find((s) => hits(s, text, 0));
      return seg ? clipMiddle(seg, text, 0) : undefined;
    }
    case 'inOut':
    case 'parallelRun':
      return ea && eb ? sharedAt(ea, eb) : undefined;
    case 'segmentOverlap':
      // a join's common tail into the gateway's vertex is not counted: the badge goes on the run that is
      return ea && eb ? sharedAt(ea, eb, joinTail(ea, eb, pl.shapes.get(p.ids[2] ?? ''))) : undefined;
    case 'edgeLeavesLane':
    case 'edgeOutside':
      return sb ? ea?.pts.find((q) => !ptIn(q, sb.b)) : undefined;
    case 'laneGap':
      if (!sa || !sb) return undefined;
      return p.detail === 'bottom' ? { x: sa.b.x + sa.b.width / 2, y: (sa.b.y + sa.b.height + sb.b.y + sb.b.height) / 2 } : { x: sa.b.x + sa.b.width / 2, y: (sa.b.y + sb.b.y) / 2 };
    case 'backwardFlow':
      return ea ? halfway(ea.pts) : undefined;
    case 'labelOutsideFrame':
    case 'messageLabelFar': {
      const own = labelOf(a);
      return own ? centreOf(own) : undefined;
    }
    case 'labelOnTitle': {
      const own = labelOf(a);
      const title = sb ? titleOf(sb) : undefined;
      return own && title ? meetCentre(own, title) : undefined;
    }
    default:
      return undefined;
  }
}

/** The element a BPMNPlane shows (bpmn-js: a plane without bpmnElement shows the first process or collaboration). */
function planeRoot(defs: El, plane: unknown): string | undefined {
  return idOf(raw(plane, 'bpmnElement')) ?? idOf(elsOf(defs, 'rootElements').find((r) => is(r, 'bpmn:Process') || is(r, 'bpmn:Collaboration')));
}

/** The problems with where each shows (`at`; see contract); the problems themselves are not changed. */
export function locateProblems(defs: El, problems: readonly LayoutProblem[]): LayoutProblem[] {
  const planes: LocPlane[] = [];
  for (const diagram of elsOf(defs, 'diagrams')) {
    const plane = raw(diagram, 'plane');
    const root = planeRoot(defs, plane);
    if (!root) continue;
    const { shapes, edges } = readPlane(plane, new Set());
    planes.push({ root, shapes: new Map(shapes.map((x) => [x.id, x])), edges: new Map(edges.map((x) => [x.id, x])) });
  }
  return problems.map((p) => {
    const first = p.ids[0];
    const pl = first === undefined ? undefined : planes.find((x) => x.shapes.has(first) || x.edges.has(first));
    const at = pl ? locate(p, pl) : undefined;
    const round = (v: number): number => Math.round(v * 100) / 100 || 0;
    return at && Number.isFinite(at.x) && Number.isFinite(at.y) ? { ...p, at: { plane: pl!.root, x: round(at.x), y: round(at.y) } } : { ...p };
  });
}

/** Parses `xml` with bpmn-moddle and measures it (import warnings count as `failed`). */
export async function layoutProblemsOfXml(xml: string): Promise<LayoutMetrics> {
  const { definitions, importWarnings } = await parseXml(xml);
  return layoutProblems(definitions, { importWarnings: importWarnings.length });
}

/** kinds whose ids form an unordered pair */
const SYMMETRIC = new Set<MetricKey>(['crossings', 'overlaps', 'frameOverlap', 'parallelRun', 'segmentOverlap']);
/** kinds whose detail is a measurement, not part of the identity */
const MEASURED = new Set<MetricKey>(['parallelRun', 'segmentOverlap', 'messageLabelFar']);

/** Identity of a problem across two measurements of the same model. */
export function problemKey(p: LayoutProblem): string {
  const unordered = SYMMETRIC.has(p.kind) || (p.kind === 'labelClash' && p.detail === 'label on label');
  const ids = unordered ? [...p.ids].sort() : p.ids;
  const detail = p.detail !== undefined && !MEASURED.has(p.kind) ? `#${p.detail}` : '';
  return `${p.kind}:${ids.join(',')}${detail}`;
}

function unmatched(list: readonly LayoutProblem[], other: readonly LayoutProblem[]): LayoutProblem[] {
  const pool = new Map<string, number>();
  for (const p of other) pool.set(problemKey(p), (pool.get(problemKey(p)) ?? 0) + 1);
  return list.filter((p) => {
    const k = problemKey(p);
    const n = pool.get(k) ?? 0;
    if (n === 0) return true;
    pool.set(k, n - 1);
    return false;
  });
}

/** Problems that appeared (`added`) and disappeared (`resolved`) between two measurements. */
export function diffProblems(before: readonly LayoutProblem[], after: readonly LayoutProblem[]): { added: LayoutProblem[]; resolved: LayoutProblem[] } {
  return { added: unmatched(after, before), resolved: unmatched(before, after) };
}

/** `layout.metrics` of a mutation result; `before` is omitted when there was no diagram before. */
export function metricsDelta(before: LayoutMetrics | undefined, after: LayoutMetrics): MetricsDelta {
  const { added, resolved } = diffProblems(before?.problems ?? [], after.problems);
  return {
    ...(before ? { before: { counts: before.counts, score: before.score } } : {}),
    after: { counts: after.counts, score: after.score },
    added,
    resolved,
  };
}
