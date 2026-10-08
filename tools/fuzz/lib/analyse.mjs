/**
 * Independent reading of a BPMN file for the fuzzer's oracles: semantics and
 * diagram interchange parsed with plain bpmn-moddle (no code from src/), the
 * structural DI invariants, and geometry snapshots for the stability check.
 *
 * Contract
 *  - `analyse(xml)` -> { defs, warnings: string[], sem, planes } or
 *    { parseError } when bpmn-moddle throws. `sem` indexes flow nodes, flows,
 *    lanes, participants, message flows, the scope of every element and the
 *    elements that need DI; `planes` holds per BPMNPlane the shapes / edges by
 *    element id plus duplicate and dangling DI.
 *  - `diInvariants(a)` -> string[] of problems keyed `<kind>|<ids...>` so two
 *    lists can be diffed: reimport (an import warning other than an unknown
 *    attribute), dupDi, danglingDi, staleDi, nanBounds, nonPositiveSize,
 *    nanLabel, negLabel, fewWaypoints, nanWaypoint, noDi, wrongPlane (DI not
 *    on the plane the element belongs to: mirrors homePlane in
 *    src/diagram/plane.ts), frameIntrusion / poolIntrusion (an expanded
 *    sub-process or pool covering a node that is not its content), frameOverlap
 *    (two sibling frames overlapping). Groups never need DI.
 *  - `geometry(a)`, `stability(before, after, reported)` and `reportedIds(layout)`:
 *    which pre-existing shapes changed bounds and which connections changed
 *    their waypoints without the mutation result reporting them. A connection
 *    that is translated as a whole or stretched by one dx / dy (the space tool)
 *    is not a reroute.
 *  - `bbox(a)`: bounding box of all shapes with finite bounds.
 * Pure apart from parsing; never throws for a parsable file.
 */
import { BpmnModdle } from 'bpmn-moddle';

const isA = (el, t) => !!el && typeof el.$instanceOf === 'function' && el.$instanceOf(t);
const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const boxOf = (b) => (b ? { x: b.x, y: b.y, w: b.width, h: b.height } : undefined);

function emptySemantics() {
  return { byId: new Map(), nodes: [], flows: [], lanes: [], participants: [], processes: [], collab: undefined, scopeOf: new Map(), laneOf: new Map(), needsDi: [], msgFlows: [] };
}

function readSemantics(defs) {
  const sem = emptySemantics();
  const reg = (el, scope) => {
    if (el.id) sem.byId.set(el.id, el);
    if (scope) sem.scopeOf.set(el.id, scope);
  };
  const walkScope = (container, scope) => {
    for (const fe of container.flowElements ?? []) {
      reg(fe, scope);
      if (isA(fe, 'bpmn:SequenceFlow')) {
        sem.flows.push(fe);
        sem.needsDi.push(fe);
      } else if (isA(fe, 'bpmn:FlowNode')) {
        sem.nodes.push(fe);
        sem.needsDi.push(fe);
        for (const da of [...(fe.dataInputAssociations ?? []), ...(fe.dataOutputAssociations ?? [])]) {
          if (!da.id) continue;
          reg(da, scope);
          sem.needsDi.push(da);
        }
        if (isA(fe, 'bpmn:SubProcess')) walkScope(fe, fe);
      } else if (isA(fe, 'bpmn:DataObjectReference') || isA(fe, 'bpmn:DataStoreReference')) {
        sem.needsDi.push(fe);
      }
    }
    for (const a of container.artifacts ?? []) {
      reg(a, scope);
      if (!isA(a, 'bpmn:Group')) sem.needsDi.push(a);
    }
  };
  const walkLanes = (laneSets, proc) => {
    for (const ls of laneSets ?? []) {
      for (const lane of ls.lanes ?? []) {
        reg(lane);
        sem.lanes.push({ id: lane.id, processId: proc.id, el: lane, hasChildren: !!lane.childLaneSet?.lanes?.length });
        sem.needsDi.push(lane);
        for (const ref of lane.flowNodeRef ?? []) if (ref?.id) sem.laneOf.set(ref.id, lane.id); // innermost wins
        if (lane.childLaneSet) walkLanes([lane.childLaneSet], proc);
      }
    }
  };
  for (const re of defs.rootElements ?? []) {
    reg(re);
    if (isA(re, 'bpmn:Collaboration')) {
      sem.collab = re;
      for (const p of re.participants ?? []) {
        reg(p, re);
        sem.participants.push({ id: p.id, processId: p.processRef?.id, el: p });
        sem.needsDi.push(p);
      }
      for (const m of re.messageFlows ?? []) {
        reg(m, re);
        sem.msgFlows.push(m);
        sem.needsDi.push(m);
      }
      for (const a of re.artifacts ?? []) {
        reg(a, re);
        if (!isA(a, 'bpmn:Group')) sem.needsDi.push(a);
      }
    } else if (isA(re, 'bpmn:Process')) {
      sem.processes.push(re);
      walkScope(re, re);
      walkLanes(re.laneSets, re);
    }
  }
  return sem;
}

function readPlane(plane) {
  const p = { id: plane.id, rootId: plane.bpmnElement?.id, shapes: new Map(), edges: new Map(), dupes: [], dangling: [] };
  for (const pe of plane.planeElement ?? []) {
    const eid = pe.bpmnElement?.id;
    if (!eid) {
      p.dangling.push(pe.id);
      continue;
    }
    if (p.shapes.has(eid) || p.edges.has(eid)) p.dupes.push(eid);
    const label = boxOf(pe.label?.bounds);
    if (isA(pe, 'bpmndi:BPMNShape')) {
      const b = pe.bounds;
      p.shapes.set(eid, { id: eid, x: b?.x, y: b?.y, w: b?.width, h: b?.height, expanded: pe.isExpanded, label });
    } else if (isA(pe, 'bpmndi:BPMNEdge')) {
      p.edges.set(eid, { id: eid, pts: (pe.waypoint ?? []).map((w) => ({ x: w.x, y: w.y })), label });
    }
  }
  return p;
}

export async function analyse(xml) {
  let defs, warnings;
  try {
    const r = await new BpmnModdle().fromXML(xml);
    defs = r.rootElement;
    warnings = r.warnings.map((w) => String(w.message));
  } catch (e) {
    return { parseError: String(e).slice(0, 500) };
  }
  const planes = (defs.diagrams ?? []).map((d) => d.plane).filter(Boolean).map(readPlane);
  return { defs, warnings, sem: readSemantics(defs), planes };
}

/** The plane an element's DI belongs on (mirrors src/diagram/plane.ts homePlane). */
function homePlane(a, el) {
  const { sem, planes } = a;
  const collabPlane = () => (sem.collab ? planes.find((p) => p.rootId === sem.collab.id) : undefined);
  const pooled = new Set(sem.participants.map((p) => p.processId).filter(Boolean));
  if (isA(el, 'bpmn:Participant') || isA(el, 'bpmn:MessageFlow')) return collabPlane();
  if (isA(el, 'bpmn:Lane')) {
    const pid = sem.lanes.find((l) => l.id === el.id)?.processId;
    return planes.find((p) => p.rootId === pid) ?? (pid && pooled.has(pid) ? collabPlane() : undefined);
  }
  const anchorId = isA(el, 'bpmn:DataAssociation') ? el.$parent?.id : el.id;
  const scope = anchorId ? sem.scopeOf.get(anchorId) : undefined;
  if (!scope) return undefined;
  if (isA(scope, 'bpmn:Collaboration')) return collabPlane();
  if (isA(scope, 'bpmn:SubProcess')) return planes.find((p) => p.shapes.get(scope.id)?.expanded) ?? planes.find((p) => p.rootId === scope.id);
  return planes.find((p) => p.rootId === scope.id) ?? (pooled.has(scope.id) ? collabPlane() : undefined);
}

function geometryProblems(p) {
  const out = [];
  for (const d of p.dupes) out.push(`dupDi|${p.rootId}|${d}`);
  for (const d of p.dangling) out.push(`danglingDi|${p.rootId}|${d}`);
  for (const s of p.shapes.values()) {
    if (![s.x, s.y, s.w, s.h].every(fin)) out.push(`nanBounds|${s.id}`);
    else if (s.w <= 0 || s.h <= 0) out.push(`nonPositiveSize|${s.id}`);
    if (s.label && ![s.label.x, s.label.y, s.label.w, s.label.h].every(fin)) out.push(`nanLabel|${s.id}`);
    if (s.label && (s.label.w < 0 || s.label.h < 0)) out.push(`negLabel|${s.id}`);
  }
  for (const e of p.edges.values()) {
    if (e.pts.length < 2) out.push(`fewWaypoints|${e.id}`);
    if (!e.pts.every((q) => fin(q.x) && fin(q.y))) out.push(`nanWaypoint|${e.id}`);
    if (e.label && ![e.label.x, e.label.y, e.label.w, e.label.h].every(fin)) out.push(`nanLabel|${e.id}`);
  }
  return out;
}

function placementProblems(a) {
  const out = [];
  for (const el of a.sem.needsDi) {
    const home = homePlane(a, el);
    const on = a.planes.filter((p) => p.shapes.has(el.id) || p.edges.has(el.id));
    if (!on.length) out.push(`noDi|${el.id}`);
    else if (home && !on.includes(home)) out.push(`wrongPlane|${el.id}|on ${on.map((p) => p.rootId).join(',')} expected ${home.rootId}`);
  }
  return out;
}

/** Ids of the scopes enclosing `id` (sub-processes, processes, the collaboration). */
function scopeChain(a, id) {
  const out = new Set();
  let s = a.sem.scopeOf.get(id);
  for (let i = 0; s && i < 30; i++) {
    out.add(s.id);
    s = a.sem.scopeOf.get(s.id);
  }
  return out;
}

const overlapsInner = (p, q) => p.x < q.x + q.w - 2 && q.x < p.x + p.w - 2 && p.y < q.y + q.h - 2 && q.y < p.y + p.h - 2;
const isLeaf = (el) => isA(el, 'bpmn:FlowNode') || isA(el, 'bpmn:DataObjectReference') || isA(el, 'bpmn:DataStoreReference') || isA(el, 'bpmn:TextAnnotation');

function framesAndLeaves(a, p) {
  const frames = [], leaves = [];
  for (const s of p.shapes.values()) {
    const el = a.sem.byId.get(s.id);
    if (!el || ![s.x, s.y, s.w, s.h].every(fin)) continue;
    if (isA(el, 'bpmn:SubProcess') && s.expanded) frames.push({ s, el, kind: 'sub' });
    else if (isA(el, 'bpmn:Participant')) frames.push({ s, el, kind: 'pool' });
    if (isLeaf(el)) leaves.push({ s, el });
  }
  return { frames, leaves };
}

/** A node drawn inside a frame it does not belong to. */
function intrudes(a, f, n) {
  if (n.el === f.el || !overlapsInner(f.s, n.s)) return false;
  if (scopeChain(a, f.el.id).has(n.el.id)) return false; // the frame's own ancestors
  if (f.kind === 'sub') {
    if (isA(n.el, 'bpmn:TextAnnotation')) return false;
    const host = n.el.attachedToRef?.id;
    if (host === f.el.id) return false;
    return !scopeChain(a, host ?? n.el.id).has(f.el.id);
  }
  const proc = f.el.processRef?.id;
  if (proc && scopeChain(a, n.el.id).has(proc)) return false;
  return !(isA(n.el, 'bpmn:TextAnnotation') && isA(a.sem.scopeOf.get(n.el.id), 'bpmn:Collaboration'));
}

function frameProblems(a) {
  const out = [];
  for (const p of a.planes) {
    const { frames, leaves } = framesAndLeaves(a, p);
    for (const f of frames) for (const n of leaves) if (intrudes(a, f, n)) out.push(`${f.kind === 'sub' ? 'frameIntrusion' : 'poolIntrusion'}|${f.el.id}|${n.el.id}`);
    for (let i = 0; i < frames.length; i++) {
      for (let j = i + 1; j < frames.length; j++) {
        const [f, g] = [frames[i], frames[j]];
        if (f.kind !== g.kind || !overlapsInner(f.s, g.s)) continue;
        if (f.kind === 'sub' && (scopeChain(a, f.el.id).has(g.el.id) || scopeChain(a, g.el.id).has(f.el.id))) continue;
        out.push(`frameOverlap|${f.el.id}|${g.el.id}`);
      }
    }
  }
  return out;
}

/** DI elements whose semantic element is gone (a group or a root element is fine). */
function staleProblems(a) {
  const out = [];
  const roots = new Set((a.defs.rootElements ?? []).map((r) => r.id));
  for (const p of a.planes) {
    for (const id of [...p.shapes.keys(), ...p.edges.keys()]) {
      if (!a.sem.byId.has(id) && !roots.has(id)) out.push(`staleDi|${p.rootId}|${id}`);
    }
  }
  return out;
}

export function diInvariants(a) {
  if (a.parseError) return [`parse|${a.parseError}`];
  const out = a.warnings.filter((w) => !/unknown attribute/i.test(w)).map((w) => `reimport|${w.split('\n')[0].slice(0, 160)}`);
  for (const p of a.planes) out.push(...geometryProblems(p));
  out.push(...placementProblems(a), ...frameProblems(a), ...staleProblems(a));
  return out;
}

export function bbox(a) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const p of a.planes ?? []) {
    for (const s of p.shapes.values()) {
      if (![s.x, s.y, s.w, s.h].every(fin)) continue;
      x1 = Math.min(x1, s.x); y1 = Math.min(y1, s.y); x2 = Math.max(x2, s.x + s.w); y2 = Math.max(y2, s.y + s.h);
    }
  }
  return { x1, y1, x2, y2, w: x2 - x1, h: y2 - y1 };
}

/** Geometry snapshot keyed `<plane root>|<element id>`. */
export function geometry(a) {
  const shapes = new Map(), edges = new Map();
  for (const p of a.planes ?? []) {
    for (const s of p.shapes.values()) shapes.set(`${p.rootId}|${s.id}`, s);
    for (const e of p.edges.values()) edges.set(`${p.rootId}|${e.id}`, e);
  }
  return { shapes, edges };
}

const sameBox = (s, t) => s.x === t.x && s.y === t.y && s.w === t.w && s.h === t.h;
const samePts = (a, b) => a.length === b.length && a.every((p, i) => p.x === b[i].x && p.y === b[i].y);

/** Every waypoint keeps its place or shifts by one common dx and / or one common dy (translation or space tool). */
function shiftedUniformly(a, b) {
  if (a.length !== b.length || !a.length) return false;
  const dxs = new Set(), dys = new Set();
  for (let i = 0; i < a.length; i++) {
    const dx = b[i].x - a[i].x, dy = b[i].y - a[i].y;
    if (dx) dxs.add(dx);
    if (dy) dys.add(dy);
  }
  return dxs.size <= 1 && dys.size <= 1;
}

export function stability(before, after, reported) {
  const unreportedShapes = [], unreportedEdges = [];
  let moved = 0, kept = 0;
  for (const [k, s] of before.shapes) {
    const t = after.shapes.get(k);
    if (!t) continue;
    if (sameBox(s, t)) { kept++; continue; }
    moved++;
    if (!reported.has(s.id)) unreportedShapes.push({ id: s.id, from: [s.x, s.y, s.w, s.h], to: [t.x, t.y, t.w, t.h] });
  }
  for (const [k, e] of before.edges) {
    const t = after.edges.get(k);
    if (!t || samePts(e.pts, t.pts) || reported.has(e.id) || shiftedUniformly(e.pts, t.pts)) continue;
    unreportedEdges.push({ id: e.id, from: e.pts.map((p) => `${p.x},${p.y}`).join(' '), to: t.pts.map((p) => `${p.x},${p.y}`).join(' ') });
  }
  return { unreportedShapes, unreportedEdges, moved, kept };
}

/** Ids a mutation result reports as placed / moved / rerouted / pruned (incremental) or touched by a format op. */
export function reportedIds(layout) {
  const s = new Set();
  if (!layout) return s;
  for (const k of ['placed', 'moved', 'rerouted', 'pruned']) for (const id of layout[k] ?? []) s.add(id);
  for (const f of layout.format ?? []) for (const k of ['moved', 'rerouted', 'colored', 'labels']) for (const id of f[k] ?? []) s.add(id);
  return s;
}
