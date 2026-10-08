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
 *  - `through` uses a real segment-rectangle test (an axis-parallel segment:
 *    the same as its bounding box); labelOnLine and msgThroughPool keep the
 *    harness's bounding-box test.
 *  - Every problem names the elements involved (`ids`), problems are listed in
 *    KEYS order and, within a kind, in the order the harness finds them:
 *      crossings      [edgeA, edgeB]           overlaps     [shapeA, shapeB]
 *      frameIntrusion [shape, frame]           frameOverlap [frameA, frameB]
 *      through        [edge, shape]            diagonal     [edge]
 *      degenerateEdge [edge]
 *      missing        [element]                labelClash   [labelOwner, shape | other labelOwner]
 *      labelOnLine    [labelOwner, edge]       inOut        [incoming, outgoing, node]
 *      parallelRun    [edgeA, edgeB]           outsideLane  [node, lane]
 *      outsidePool    [node, participant]      outsideSub   [node, subProcess]
 *      edgeLeavesLane [flow, lane]             edgeOutside  [flow, participant | subProcess]
 *      msgThroughPool [messageFlow, participant]
 *      laneGap        [lane, participant]      failed       []
 *    `detail` carries the label variant ('label on shape' | 'label on label'),
 *    the lane side ('top' | 'bottom'), the collinear length of a parallel run
 *    ('35px') or the failure message.
 *  - `failed` only comes from import warnings, which layoutProblemsOfXml (or a
 *    caller passing `importWarnings`) reports; the harness additionally uses it
 *    for a crashed layout command.
 *  - Read-only: model properties are read directly, never through `get()`,
 *    which would materialise empty collections on the model.
 *  - diffProblems(before, after) matches problems by problemKey: the kind, the
 *    ids (order-free for symmetric kinds) and the detail unless it is a
 *    measurement (parallelRun length). Duplicates are matched one to one.
 */
import { is, parseXml, type El } from '../model.js';
import type { Box, Point } from '../layout/types.js';

/** structural defects the regression harness does not measure (see contract) */
export const EXTRA_KEYS = ['frameIntrusion', 'frameOverlap', 'degenerateEdge'] as const;

export const KEYS = [
  'crossings',
  'overlaps',
  'frameIntrusion',
  'frameOverlap',
  'through',
  'diagonal',
  'degenerateEdge',
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
  'failed',
] as const;

export type MetricKey = (typeof KEYS)[number];

/** the kinds of the regression harness (tools/layout-regress.mjs), in its order */
export const HARNESS_KEYS: readonly MetricKey[] = KEYS.filter((k) => !(EXTRA_KEYS as readonly string[]).includes(k));

export const WEIGHTS: Readonly<Record<MetricKey, number>> = {
  crossings: 5,
  overlaps: 10,
  frameIntrusion: 10,
  frameOverlap: 10,
  through: 8,
  diagonal: 3,
  degenerateEdge: 10,
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
  failed: 50,
};

export interface LayoutProblem {
  kind: MetricKey;
  ids: string[];
  detail?: string;
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

function collectScope(scope: El, sem: Semantics): void {
  for (const fe of elsOf(scope, 'flowElements')) {
    const id = idOf(fe);
    if (id) {
      sem.parentOf.set(id, scope);
      const drawn = is(fe, 'bpmn:FlowNode') || is(fe, 'bpmn:SequenceFlow') || is(fe, 'bpmn:DataObjectReference') || is(fe, 'bpmn:DataStoreReference');
      if (drawn) sem.need.add(id);
    }
    if (is(fe, 'bpmn:SubProcess')) collectScope(fe, sem);
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
  const sem: Semantics = { parentOf: new Map(), laneOf: new Map(), poolOf: new Map(), need: new Set() };
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

function analysePlane(plane: unknown, sem: Semantics, seen: Set<string>, add: Add): void {
  const { shapes, edges } = readPlane(plane, seen);
  const ctx: PlaneCtx = {
    sem,
    shapes,
    edges,
    leaf: shapes.filter((s) => !s.container),
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

/** Parses `xml` with bpmn-moddle and measures it (import warnings count as `failed`). */
export async function layoutProblemsOfXml(xml: string): Promise<LayoutMetrics> {
  const { definitions, importWarnings } = await parseXml(xml);
  return layoutProblems(definitions, { importWarnings: importWarnings.length });
}

/** kinds whose ids form an unordered pair */
const SYMMETRIC = new Set<MetricKey>(['crossings', 'overlaps', 'frameOverlap', 'parallelRun']);
/** kinds whose detail is a measurement, not part of the identity */
const MEASURED = new Set<MetricKey>(['parallelRun']);

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
