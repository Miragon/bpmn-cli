/**
 * The diagram as plain data: every BPMNDiagram's plane read into shapes and
 * edges the incremental engine can move around without touching moddle.
 *
 * CONTRACT
 *  - readPlanes(defs, sem) returns one Plane per BPMNDiagram (document order).
 *    Every BPMNShape / BPMNEdge whose bpmnElement resolves to an element with
 *    an id becomes a DShape / DEdge keyed by that id; bounds, waypoints and
 *    label bounds are COPIED (write.ts writes them back), `el` / `di` point at
 *    the live moddle objects.
 *    A plane without bpmnElement shows displayRoot(defs) (as in bpmn-js);
 *    write.ts then records that root on it.
 *    A BPMNShape without valid bounds is not a shape: its element counts as
 *    undrawn, the DI is kept in `unbounded` for the placement to reuse.
 *  - Membership comes from the semantic model, never from geometry:
 *      laneId   innermost lane listing the node in flowNodeRef (nested lanes
 *               included); for a lane: its parent lane
 *      poolId   the participant whose processRef is the element's process
 *               (walking out of sub-processes); for a lane: its pool
 *      parentId the sub-process directly containing the element, when that
 *               sub-process is drawn expanded on the same plane
 *      hostId   the activity a boundary event is attached to
 *  - Reading is side-effect free: properties are read directly, never through
 *    `get()` (which would materialise empty collections on the model).
 *  - semantics(defs) indexes the semantic model once (ids, lanes, pools,
 *    scopes); homePlane() says on which plane an element's DI belongs.
 */
import { is, type El } from '../model/utils/moddle.js';
import type { DEdge, DShape, Plane, Semantics } from './types.js';
import { boxOf, displayRoot, edgeEnds, edgeKind, idOf, isSubProcess, raw, rawList, shapeKind } from './utils/plane.js';

/* ------------------------------------------------------------------ */
/* raw access                                                           */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* kinds                                                                */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* semantics                                                            */
/* ------------------------------------------------------------------ */

function indexScope(scope: El, sem: Semantics): void {
  for (const fe of rawList(scope, 'flowElements')) {
    const id = idOf(fe);
    if (id) sem.scopeOf.set(id, scope);
    if (isSubProcess(fe)) indexScope(fe, sem);
  }
  for (const a of rawList(scope, 'artifacts')) {
    const id = idOf(a);
    if (id) sem.scopeOf.set(id, scope);
  }
}

function indexLanes(lanes: El[], process: El, parent: El | undefined, sem: Semantics): void {
  for (const lane of lanes) {
    const id = idOf(lane);
    if (!id) continue;
    sem.laneProcess.set(id, idOf(process)!);
    if (parent) sem.laneParent.set(id, idOf(parent)!);
    for (const node of rawList(lane, 'flowNodeRef')) {
      const nid = idOf(node);
      if (nid) sem.laneOf.set(nid, id); // deeper lanes are visited later and win
    }
    const child = raw<El>(lane, 'childLaneSet');
    if (child) indexLanes(rawList(child, 'lanes'), process, lane, sem);
  }
}

function indexAll(root: El, byId: Map<string, El>): void {
  const stack: El[] = [root];
  const seen = new Set<El>();
  while (stack.length) {
    const el = stack.pop()!;
    if (seen.has(el)) continue;
    seen.add(el);
    if (/^(bpmndi|dc|di):/.test(el.$type)) continue;
    const id = idOf(el);
    if (id) byId.set(id, el);
    const descriptor = el.$descriptor as { isGeneric?: boolean; properties?: Array<{ name: string; isReference?: boolean }> };
    if (descriptor.isGeneric) continue;
    for (const p of descriptor.properties ?? []) {
      if (p.isReference) continue;
      const v = raw<unknown>(el, p.name);
      if (Array.isArray(v)) {
        for (const c of v) if (c && typeof c === 'object' && '$type' in c) stack.push(c as El);
      } else if (v && typeof v === 'object' && '$type' in v) stack.push(v as El);
    }
  }
}

export function semantics(defs: El): Semantics {
  const sem: Semantics = { byId: new Map(), laneOf: new Map(), laneParent: new Map(), laneProcess: new Map(), poolOfProcess: new Map(), scopeOf: new Map() };
  indexAll(defs, sem.byId);
  for (const root of rawList(defs, 'rootElements')) {
    if (is(root, 'bpmn:Process')) {
      indexScope(root, sem);
      for (const ls of rawList(root, 'laneSets')) indexLanes(rawList(ls, 'lanes'), root, undefined, sem);
    } else if (is(root, 'bpmn:Collaboration')) {
      sem.collaboration ??= root;
      for (const p of rawList(root, 'participants')) {
        const pid = idOf(raw(p, 'processRef'));
        if (pid && idOf(p)) sem.poolOfProcess.set(pid, idOf(p)!);
      }
      for (const a of rawList(root, 'artifacts')) {
        const id = idOf(a);
        if (id) sem.scopeOf.set(id, root);
      }
    }
  }
  return sem;
}

/** The process an element lives in (walking out of sub-processes). */
export function processOf(sem: Semantics, id: string): El | undefined {
  let scope = sem.scopeOf.get(id);
  while (scope && !is(scope, 'bpmn:Process')) scope = sem.scopeOf.get(idOf(scope) ?? '');
  return scope;
}

/** The participant an element (flow element, artifact, lane) belongs to. */
export function poolOf(sem: Semantics, id: string): string | undefined {
  const el = sem.byId.get(id);
  if (!el) return undefined;
  if (is(el, 'bpmn:Participant')) return undefined;
  if (is(el, 'bpmn:Lane')) {
    const pid = sem.laneProcess.get(id);
    return pid ? sem.poolOfProcess.get(pid) : undefined;
  }
  const proc = processOf(sem, id);
  return proc ? sem.poolOfProcess.get(idOf(proc) ?? '') : undefined;
}

/* ------------------------------------------------------------------ */
/* reading                                                              */
/* ------------------------------------------------------------------ */

function readShape(di: El, el: El, id: string, sem: Semantics): DShape | undefined {
  const bounds = boxOf(raw(di, 'bounds'));
  if (!bounds) return undefined;
  const kind = shapeKind(el);
  const expanded = kind === 'subProcess' ? raw<boolean>(di, 'isExpanded') === true : undefined;
  const container = kind === 'participant' || kind === 'lane' || (kind === 'subProcess' && expanded === true);
  const label = boxOf(raw(raw(di, 'label'), 'bounds'));
  const s: DShape = { id, el, di, bounds, kind, container };
  if (expanded !== undefined) s.expanded = expanded;
  if (label) s.label = label;
  if (kind === 'boundary') {
    const host = idOf(raw(el, 'attachedToRef'));
    if (host) s.hostId = host;
  }
  const lane = kind === 'lane' ? sem.laneParent.get(id) : sem.laneOf.get(id);
  if (lane) s.laneId = lane;
  const pool = poolOf(sem, id);
  if (pool) s.poolId = pool;
  return s;
}

function readEdge(di: El, el: El, id: string): DEdge {
  const points = rawList(di, 'waypoint').map((w) => ({ x: raw<number>(w, 'x') ?? 0, y: raw<number>(w, 'y') ?? 0 }));
  const label = boxOf(raw(raw(di, 'label'), 'bounds'));
  const e: DEdge = { id, el, di, kind: edgeKind(el), points, ...edgeEnds(el) };
  if (label) e.label = label;
  return e;
}

/** Sets parentId for shapes whose sub-process is drawn expanded on the same plane. */
function linkParents(plane: Plane, sem: Semantics): void {
  for (const s of plane.shapes.values()) {
    const scope = sem.scopeOf.get(s.id);
    const sid = idOf(scope);
    if (!scope || !sid || !isSubProcess(scope)) continue;
    const parent = plane.shapes.get(sid);
    if (parent?.expanded) s.parentId = sid;
  }
}

export function readPlane(diagram: El, sem: Semantics): Plane | undefined {
  const di = raw<El>(diagram, 'plane');
  const root = raw<El>(di, 'bpmnElement') ?? (di ? displayRoot(diagram.$parent as El | undefined) : undefined);
  const rootId = idOf(root);
  if (!di || !root || !rootId) return undefined;
  const plane: Plane = { id: idOf(di) ?? `BPMNPlane_${rootId}`, di, rootId, root, shapes: new Map(), edges: new Map(), dropped: [] };
  for (const pe of rawList(di, 'planeElement')) {
    const el = raw<El>(pe, 'bpmnElement');
    const id = idOf(el);
    if (!el || !id) continue;
    if (is(pe, 'bpmndi:BPMNShape')) {
      const s = readShape(pe, el, id, sem);
      if (s) plane.shapes.set(id, s);
      else (plane.unbounded ??= new Map()).set(id, pe);
    } else if (is(pe, 'bpmndi:BPMNEdge')) {
      plane.edges.set(id, readEdge(pe, el, id));
    }
  }
  linkParents(plane, sem);
  return plane;
}

export function readPlanes(defs: El, sem: Semantics = semantics(defs)): Plane[] {
  const out: Plane[] = [];
  for (const diagram of rawList(defs, 'diagrams')) {
    const plane = readPlane(diagram, sem);
    if (plane) out.push(plane);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* queries                                                              */
/* ------------------------------------------------------------------ */

/**
 * The plane an element's DI belongs on: the plane of its expanded parent
 * sub-process, the own plane of a collapsed parent, the collaboration plane
 * for pool content, else the plane of its process. Undefined when that plane
 * does not exist yet (a collapsed sub-process without diagram).
 */
export function homePlane(planes: readonly Plane[], sem: Semantics, id: string): Plane | undefined {
  const el = sem.byId.get(id);
  if (!el) return undefined;
  const collabPlane = (): Plane | undefined => (sem.collaboration ? planes.find((p) => p.rootId === idOf(sem.collaboration)) : undefined);
  if (is(el, 'bpmn:Participant') || is(el, 'bpmn:MessageFlow')) return collabPlane();
  if (is(el, 'bpmn:Lane')) {
    const pid = sem.laneProcess.get(id);
    return planes.find((p) => p.rootId === pid) ?? (pid && sem.poolOfProcess.has(pid) ? collabPlane() : undefined);
  }
  const anchorId = is(el, 'bpmn:DataAssociation') ? idOf(el.$parent) : id;
  const scope = anchorId ? sem.scopeOf.get(anchorId) : undefined;
  const sid = idOf(scope);
  if (!scope || !sid) return undefined;
  if (is(scope, 'bpmn:Collaboration')) return collabPlane();
  if (isSubProcess(scope)) {
    const expandedOn = planes.find((p) => p.shapes.get(sid)?.expanded);
    if (expandedOn) return expandedOn;
    return planes.find((p) => p.rootId === sid);
  }
  return planes.find((p) => p.rootId === sid) ?? (sem.poolOfProcess.has(sid) ? collabPlane() : undefined);
}

