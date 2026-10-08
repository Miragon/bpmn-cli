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
import { is, type El } from '../model.js';
import type { ShapeKind } from './router.js';
import { unionAll, type Box, type Point } from './geom.js';

export type EdgeKind = 'sequenceFlow' | 'messageFlow' | 'association' | 'dataAssociation' | 'other';

export interface DShape {
  id: string;
  el: El;
  /** the BPMNShape; undefined for an element placed by the engine until write.ts creates it */
  di?: El;
  bounds: Box;
  kind: ShapeKind;
  /** pool, lane or expanded sub-process */
  container: boolean;
  expanded?: boolean;
  label?: Box;
  hostId?: string;
  laneId?: string;
  poolId?: string;
  parentId?: string;
}

export interface DEdge {
  id: string;
  el: El;
  di?: El;
  kind: EdgeKind;
  sourceId?: string;
  targetId?: string;
  points: Point[];
  label?: Box;
}

export interface Plane {
  /** BPMNPlane id */
  id: string;
  /** the BPMNPlane; undefined for a plane the engine creates until write.ts writes it */
  di?: El;
  /** id of the element the plane shows: collaboration, process or collapsed sub-process */
  rootId: string;
  root: El;
  shapes: Map<string, DShape>;
  edges: Map<string, DEdge>;
  /** DI elements write.ts deletes */
  dropped: El[];
  /**
   * BPMNShapes without valid bounds (missing, NaN), by element id: the
   * element counts as undrawn and is placed, reusing this DI (and its colours)
   */
  unbounded?: Map<string, El>;
  /** write.ts deletes the whole diagram (its content moved elsewhere) */
  deleted?: boolean;
}

export interface Semantics {
  /** semantic elements by id (no DI) */
  byId: Map<string, El>;
  /** flow node id -> innermost lane id */
  laneOf: Map<string, string>;
  /** lane id -> parent lane id */
  laneParent: Map<string, string>;
  /** lane id -> process id */
  laneProcess: Map<string, string>;
  /** process id -> participant id */
  poolOfProcess: Map<string, string>;
  /** flow element / artifact id -> containing process or sub-process */
  scopeOf: Map<string, El>;
  /** the collaboration, if any */
  collaboration?: El;
}

/* ------------------------------------------------------------------ */
/* raw access                                                           */
/* ------------------------------------------------------------------ */

export function raw<T>(el: unknown, prop: string): T | undefined {
  return el && typeof el === 'object' ? ((el as Record<string, unknown>)[prop] as T | undefined) : undefined;
}

export const rawList = (el: unknown, prop: string): El[] => raw<El[]>(el, prop) ?? [];

export const idOf = (el: unknown): string | undefined => raw<string>(el, 'id');

function boxOf(bounds: unknown): Box | undefined {
  if (!bounds) return undefined;
  const b = { x: raw<number>(bounds, 'x'), y: raw<number>(bounds, 'y'), width: raw<number>(bounds, 'width'), height: raw<number>(bounds, 'height') };
  if ([b.x, b.y, b.width, b.height].some((v) => typeof v !== 'number' || !Number.isFinite(v))) return undefined;
  return b as Box;
}

/* ------------------------------------------------------------------ */
/* kinds                                                                */
/* ------------------------------------------------------------------ */

export const SUB_PROCESS = ['bpmn:SubProcess', 'bpmn:AdHocSubProcess', 'bpmn:Transaction'];

export function isSubProcess(el: El): boolean {
  return SUB_PROCESS.some((t) => is(el, t));
}

export function shapeKind(el: El): ShapeKind {
  if (is(el, 'bpmn:BoundaryEvent')) return 'boundary';
  if (is(el, 'bpmn:Event')) return 'event';
  if (is(el, 'bpmn:Gateway')) return 'gateway';
  if (isSubProcess(el)) return 'subProcess';
  if (is(el, 'bpmn:Activity')) return 'task';
  if (is(el, 'bpmn:DataObjectReference') || is(el, 'bpmn:DataStoreReference') || is(el, 'bpmn:DataInput') || is(el, 'bpmn:DataOutput')) return 'data';
  if (is(el, 'bpmn:TextAnnotation')) return 'annotation';
  if (is(el, 'bpmn:Participant')) return 'participant';
  if (is(el, 'bpmn:Lane')) return 'lane';
  if (is(el, 'bpmn:Group')) return 'group';
  return 'other';
}

export function edgeKind(el: El): EdgeKind {
  if (is(el, 'bpmn:SequenceFlow')) return 'sequenceFlow';
  if (is(el, 'bpmn:MessageFlow')) return 'messageFlow';
  if (is(el, 'bpmn:Association')) return 'association';
  if (is(el, 'bpmn:DataAssociation')) return 'dataAssociation';
  return 'other';
}

/** Shapes that are drawn as obstacles / take part in overlap removal (not containers, not groups). */
export function isLeaf(s: DShape): boolean {
  return !s.container && s.kind !== 'group';
}

/** The semantic ends of a connection (data associations: the activity is the parent element). */
export function edgeEnds(el: El): { sourceId?: string; targetId?: string } {
  if (is(el, 'bpmn:DataInputAssociation')) {
    const src = rawList(el, 'sourceRef')[0];
    return { sourceId: idOf(src), targetId: idOf(el.$parent) };
  }
  if (is(el, 'bpmn:DataOutputAssociation')) return { sourceId: idOf(el.$parent), targetId: idOf(raw(el, 'targetRef')) };
  return { sourceId: idOf(raw(el, 'sourceRef')), targetId: idOf(raw(el, 'targetRef')) };
}

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

/**
 * The element a BPMNPlane without bpmnElement shows: like bpmn-js (which
 * corrects such DI on import), the first process or collaboration.
 */
export function displayRoot(defs: El | undefined): El | undefined {
  return rawList(defs, 'rootElements').find((r) => is(r, 'bpmn:Process') || is(r, 'bpmn:Collaboration'));
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

/** The plane a shape or edge with this id is drawn on. */
export function planeWith(planes: readonly Plane[], id: string): Plane | undefined {
  return planes.find((p) => p.shapes.has(id) || p.edges.has(id));
}

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

/**
 * The innermost frame of a shape: its expanded parent sub-process, else its
 * lane, else its pool (undefined at plane level).
 */
export function frameOf(plane: Plane, s: Pick<DShape, 'parentId' | 'laneId' | 'poolId' | 'kind'>): DShape | undefined {
  if (s.parentId) {
    const p = plane.shapes.get(s.parentId);
    if (p) return p;
  }
  if (s.laneId) {
    const l = plane.shapes.get(s.laneId);
    if (l) return l;
  }
  if (s.poolId) return plane.shapes.get(s.poolId);
  return undefined;
}

/** True when `frame` is `s`'s frame or an ancestor of it (undefined: the plane, which holds everything). */
export function inFrame(plane: Plane, s: Pick<DShape, 'parentId' | 'laneId' | 'poolId' | 'kind'>, frame: DShape | undefined): boolean {
  if (!frame) return true;
  let f = frameOf(plane, s);
  for (let i = 0; f && i < 12; i++) {
    if (f === frame) return true;
    f = frameOf(plane, f);
  }
  return false;
}

/** Inner area of a frame where content may sit (headers and padding left out). */
export function frameInterior(frame: DShape, pad = 15): Box {
  const head = frame.kind === 'participant' || frame.kind === 'lane' ? 30 : 0;
  const top = frame.kind === 'subProcess' ? Math.max(pad, 25) : pad;
  const b = frame.bounds;
  return { x: b.x + head + pad, y: b.y + top, width: Math.max(0, b.width - head - 2 * pad), height: Math.max(0, b.height - top - pad) };
}

/** The leaf shapes of a plane (no containers, no groups). */
export function leaves(plane: Plane): DShape[] {
  return [...plane.shapes.values()].filter(isLeaf);
}

/** Shapes and edges drawn inside an expanded sub-process (all depths). */
export function contentOf(plane: Plane, subId: string): { shapes: DShape[]; edges: DEdge[] } {
  const inside = new Set<string>();
  let grew = true;
  while (grew) {
    grew = false;
    for (const s of plane.shapes.values()) {
      if (inside.has(s.id)) continue;
      if (s.parentId === subId || (s.parentId && inside.has(s.parentId)) || (s.hostId && inside.has(s.hostId))) {
        inside.add(s.id);
        grew = true;
      }
    }
  }
  const shapes = [...plane.shapes.values()].filter((s) => inside.has(s.id));
  const edges = [...plane.edges.values()].filter((e) => (e.sourceId && inside.has(e.sourceId)) || (e.targetId && inside.has(e.targetId)));
  return { shapes, edges };
}

/** Boundary events attached to a host, in plane order. */
export function boundariesOf(plane: Plane, hostId: string): DShape[] {
  return [...plane.shapes.values()].filter((s) => s.hostId === hostId);
}

/** Bounding box of the leaf content of a plane (or of the shapes passing `filter`). */
export function contentBox(plane: Plane, filter: (s: DShape) => boolean = isLeaf): Box | undefined {
  return unionAll([...plane.shapes.values()].filter(filter).map((s) => s.bounds));
}
