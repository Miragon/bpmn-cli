/**
 * Incremental layout: keep the drawing, place what is new, make room like
 * the modeler's space tool, reroute only the connections that need it.
 *
 * CONTRACT
 *  takeSnapshot(defs) records, BEFORE the ops run, what every DI element
 *  shows (by DI object, so renamed ids and retyped elements are still
 *  recognised) plus the semantic facts the diff needs (lanes, scopes, names,
 *  flow ends).
 *
 *  layoutIncremental(doc, snapshot, opts) runs AFTER the ops and rewrites the
 *  DI in place:
 *   1. DI of removed elements is pruned; the layout root's plane follows a new
 *      collaboration (first pool wrapping the process)
 *   2. nodes re-inserted elsewhere (`move`, opts.relocated, or a changed
 *      scope / plane) and boundary events attached to another host lose
 *      their position and are placed like new nodes (their DI is reused, a
 *      host brings its boundary events and content along); the strip a
 *      removed or relocated node leaves is closed when empty; when something
 *      in another row reaches into it, only the node's own row closes (the
 *      strip, ending where the next shape on that row starts, closed within
 *      the row band: the successors on that row move back so that the next
 *      one takes the removed node's place), unless a moved shape would then
 *      come within 10 px of one that stays, enter or leave a group or frame
 *      that stays, or be connected to a shape that stays beyond the strip in
 *      the same frame (a branch in another row: the structure would tear) or
 *      to an artifact that stays (then nothing moves). Scopes, lanes,
 *      hosts and flow ends are compared by the ids the elements have now
 *      (Snapshot.els), so `set id=` relocates and reroutes nothing
 *   3. sub-processes change expansion (collapse: content to its own plane;
 *      expand: content moves in, room is made); a sub-process retyped to a
 *      task shrinks around its centre
 *   4. new pools / lanes are drawn, removed lanes / pools give their band back
 *   5. nodes whose lane changed move into the new lane band (same x); a
 *      join drawn before the ops that a new flow would enter backwards (its
 *      centre left of the flow's source, which it does not lead back to)
 *      is placed again right of its rightmost source, before its one
 *      successor (pullJoins; its DI is reused, it is reported as moved)
 *   6. new flow nodes and artifacts are placed (diagram/place.ts) in op order
 *      (opts.created) where their neighbours allow; while more follow, the
 *      sequence flows of each placed node are routed right away, and so are
 *      the connections the placement broke (sequence flows, associations and
 *      data associations; message flows wait for step 8), and the spacing is
 *      measured again
 *      (routeNow: what the next single command would see); a new expanded
 *      sub-process with content and a new pool with content are laid out by
 *      the clean engine as one block and placed like a node of that size;
 *      an activity (task, call activity, collapsed sub-process) whose new or
 *      changed name does not fit its box (diagram/text.ts activitySize: bpmn-js line
 *      breaking, room kept for a marker or boundary events on the bottom
 *      border) grows: wider in steps of 20 up to 200 px, then higher around
 *      its centre row, never smaller. Its left border stays, its boundary
 *      events are re-seated, and when the wider box comes closer than the
 *      drawing's gap (at most 40 px) to what follows on its row (shapes and
 *      their labels), the space tool makes room by the added width (anchored
 *      at the activity); an external label the grown box covers is placed
 *      again (step 9); a renamed expanded sub-process whose title (diagram/text.ts
 *      titleBox) now takes more lines than the old one did and comes closer
 *      than 4 px to the shapes and labels drawn in it under the title
 *      (inside the frame, below its top border: not a message flow's label
 *      between the pools) makes room: its content moves down by the
 *      difference, at most by the depth the title gained, and it grows
 *      (space tool at its top in frame mode, a note says so)
 *   7. local overlap removal around everything placed or moved (diagram/separate.ts)
 *   8. connections: new ones are routed, kept ones are rerouted only when an
 *      end changed, was placed or moved away from it, or when they now cut a
 *      shape (diagram/reroute.ts); connections entirely inside a shifted region were
 *      translated by the space tool. A connection routed during step 6 is
 *      routed again only when it broke since (like a flow an earlier single
 *      command drew); an existing one counts as rerouted
 *   9. labels of new / renamed elements and rerouted named flows are placed;
 *      a kept label a new line runs over or a grown activity covers steps
 *      aside (and the label of a boundary event the placement moved to its
 *      host's top border), and so does a label now on the title of an
 *      expanded sub-process that it was clear of before the ops (diagram/labels.ts
 *      clearTitles: room made in a sub-process moves its centred title by
 *      half the added width, a label beyond the line by all of it; a renamed
 *      title can be wider), unless its new spot is on a title too or outside
 *      its sub-process / pool
 *  10. local repair (repairCrossings, issue #18 (3)): for every crossing
 *      between a connection drawn in this run and an existing one, at most
 *      REPAIR_TRIALS trials per write: the new connection is routed again,
 *      else the existing one (with the new shapes as obstacles); a crossing
 *      left: the branch or exception path it belongs to starts at its next
 *      row candidate (steps 6 to 9 run again from a checkpoint taken before
 *      step 6, at most CHAIN_RETRIES times). A trial is kept only when it
 *      adds no hard layout problem and no crossing between two connections
 *      drawn before the run, and lowers the score (the guard `compact` uses;
 *      the drawing is written to the DI and measured after each trial). An existing connection kept rerouted is reported in
 *      `rerouted` and a note, a chain placed again in a note
 *  A further BPMNDiagram showing a root another diagram already shows (a
 *  second view of the same process) is left untouched, except that DI of
 *  removed elements is pruned there too, and so is the edge of a flow whose
 *  ends changed (pruneReEnded: it would show the old ends; a note names
 *  them). A kept connection that does not reach an end of its own
 *  (diagram/reroute.ts detachedEnds: left at the end's old place by another tool or
 *  an older --no-layout write) counts as broken in step 8 and is rerouted,
 *  whatever it looked like before; not on a plane with vertical pools /
 *  lanes, where nothing is routed (it stays as drawn there).
 *  Invariants checked before returning: no element gets a second DI element
 *  on a plane (an internal error otherwise), and nothing is placed, moved or
 *  routed on a plane with vertical pools / lanes (unsupported: an error, so
 *  auto mode redraws in full).
 *  Untouched shapes keep their exact bounds, untouched connections their
 *  waypoints. Returns `{mode:'incremental', placed, moved, rerouted, pruned,
 *  notes}` (ids; `placed` = elements that got new DI, `moved` = pre-existing
 *  shapes whose bounds changed).
 *
 *  engineOwned(geometry, laidOut) says whether a drawing (everything it
 *  shows, diagramGeometry(defs)) equals what the engine drew for the same
 *  model in `laidOut`: the same shapes and connections, every bound, label
 *  and waypoint within 2 px.
 */
import { LayoutDebug } from '../shared/LayoutDebug.js';
import type { Doc } from '../model/Doc.js';
import { resolveExpanded } from './index.js';
import { layoutClean } from './clean/engine.js';
import { SIZES } from '../diagram/types.js';
import { is, layoutRoot, parseXml, type El } from '../model/utils/moddle.js';
import { successorOf } from '../model/ChangeSet.js';
import { collapse, expand, placeLane, placePool, removedLane, removedPool, reseatBoundaries, wrapPool } from '../diagram/containers.js';
import { bottom, containsPoint, copyBox, copyPoints, cx, cy, inside, overlaps, right, sameBox, samePoints, segmentHits, type Box, type Point } from '../diagram/geom.js';
import { clearTitles, hasExternalLabel, placeEdgeLabel, placeShapeLabel, refitLabel } from '../diagram/labels.js';
import { layoutProblems, problemKey, WEIGHTS, type LayoutMetrics, type LayoutProblem } from '../diagram/metrics.js';
import { changeLane, placeArtifact, placeFlowNodes, predecessors, spacingOf, successors, newShape, type PlaceCtx, type Spacing } from '../diagram/place.js';
import { boundariesOf, boxOf, contentOf, edgeEnds, edgeKind, frameInterior, frameOf, homePlane, idOf, inFrame, isLeaf, isSubProcess, raw, rawList, readPlanes, semantics, titleOf, type DEdge, type DShape, type Plane, type Semantics } from '../diagram/plane.js';
import { brokenEdge, DETACHED_GAP, detachedEnds, edgeBefore, routeEdge, routeRank, routingLines, type EdgeBefore } from '../diagram/reroute.js';
import { separate } from '../diagram/separate.js';
import { attachedSide } from '../diagram/router.js';
import { closeStrip, fitInFrame, makeSpace } from '../diagram/space.js';
import { activitySize, BOTTOM_ROOM, titleBox } from '../diagram/text.js';
import { pruneDi, pruneEdges, writePlanes } from '../diagram/write.js';
import { PlaneCheckpoint } from '../diagram/PlaneCheckpoint.js';

/* ------------------------------------------------------------------ */
/* snapshot                                                             */
/* ------------------------------------------------------------------ */

export interface SnapEntry {
  id: string;
  /** the BPMNPlane the DI element was in */
  planeDi?: El;
  type: string;
  kind: string;
  bounds?: Box;
  label?: Box;
  points?: Point[];
  expanded?: boolean;
  laneId?: string;
  poolId?: string;
  parentId?: string;
  sourceId?: string;
  targetId?: string;
}

export interface Snapshot {
  byDi: Map<El, SnapEntry>;
  /**
   * every element by the id it had before the ops: `set id=` renames the
   * element object in place, so idOf(els.get(oldId)) is its id now (a retyped
   * element is a new object with the old id)
   */
  els: Map<string, El>;
  /** flow node id -> innermost lane id */
  laneOf: Map<string, string>;
  /** element id -> scope id */
  scopeOf: Map<string, string>;
  /** boundary event id -> host id */
  hostOf: Map<string, string>;
  names: Map<string, string>;
  /** every sequence flow's ends (with or without DI) */
  flowEnds: Map<string, { sourceId?: string; targetId?: string }>;
  rootId?: string;
  /** flow nodes that have a shape */
  flowNodeShapes: number;
  /** flow nodes without a shape on a diagram that exists (a stale drawing, e.g. after --no-layout) */
  undrawn: string[];
}

/** The id an element known by its id before the ops has now (follows `set id=` renames). */
export function currentId(snap: Snapshot, oldId: string): string;
export function currentId(snap: Snapshot, oldId: string | undefined): string | undefined;
export function currentId(snap: Snapshot, oldId: string | undefined): string | undefined {
  if (oldId === undefined) return undefined;
  return idOf(snap.els.get(oldId)) ?? oldId;
}

export function takeSnapshot(defs: El): Snapshot {
  const sem = semantics(defs);
  const snap: Snapshot = { byDi: new Map(), els: new Map(sem.byId), laneOf: new Map(sem.laneOf), scopeOf: new Map(), hostOf: new Map(), names: new Map(), flowEnds: new Map(), flowNodeShapes: 0, undrawn: [] };
  const rootId = idOf(layoutRoot(defs));
  if (rootId) snap.rootId = rootId;
  for (const [id, scope] of sem.scopeOf) {
    const sid = idOf(scope);
    if (sid) snap.scopeOf.set(id, sid);
  }
  for (const [id, el] of sem.byId) {
    const name = raw<string>(el, 'name');
    if (name !== undefined) snap.names.set(id, name);
    if (is(el, 'bpmn:SequenceFlow')) snap.flowEnds.set(id, { sourceId: idOf(raw(el, 'sourceRef')), targetId: idOf(raw(el, 'targetRef')) });
    const host = is(el, 'bpmn:BoundaryEvent') ? idOf(raw(el, 'attachedToRef')) : undefined;
    if (host) snap.hostOf.set(id, host);
  }
  const planes = readPlanes(defs, sem);
  for (const plane of planes) {
    for (const s of plane.shapes.values()) {
      if (!s.di) continue;
      if (is(s.el, 'bpmn:FlowNode')) snap.flowNodeShapes++;
      snap.byDi.set(s.di, {
        id: s.id,
        ...(plane.di ? { planeDi: plane.di } : {}),
        type: s.el.$type,
        kind: s.kind,
        bounds: copyBox(s.bounds),
        ...(s.label ? { label: copyBox(s.label) } : {}),
        ...(s.expanded !== undefined ? { expanded: s.expanded } : {}),
        ...(s.laneId ? { laneId: s.laneId } : {}),
        ...(s.poolId ? { poolId: s.poolId } : {}),
        ...(s.parentId ? { parentId: s.parentId } : {}),
      });
    }
    for (const e of plane.edges.values()) {
      if (!e.di) continue;
      snap.byDi.set(e.di, {
        id: e.id,
        ...(plane.di ? { planeDi: plane.di } : {}),
        type: e.el.$type,
        kind: e.kind,
        points: copyPoints(e.points),
        ...(e.label ? { label: copyBox(e.label) } : {}),
        ...(e.sourceId ? { sourceId: e.sourceId } : {}),
        ...(e.targetId ? { targetId: e.targetId } : {}),
      });
    }
  }
  if (snap.flowNodeShapes) {
    for (const [id, el] of sem.byId) {
      if (!is(el, 'bpmn:FlowNode')) continue;
      const home = homePlane(planes, sem, id);
      if (home && !home.shapes.has(id)) snap.undrawn.push(id);
    }
  }
  return snap;
}

/* ------------------------------------------------------------------ */
/* edges of flows whose ends changed                                    */
/* ------------------------------------------------------------------ */

/** An end a flow got since the snapshot: which end, and its id now ('' when the flow lost it). */
export interface ChangedEnd {
  end: 'source' | 'target';
  id: string;
}

/**
 * The ends the sequence or message flow a BPMNEdge shows got since the
 * snapshot, compared by the ids its ends have now: a renamed end is the same
 * end (`set id=`), and so is a retyped one, also when the batch renamed it
 * after the retype (endNow follows the element that took its place). Empty
 * for an unchanged flow and for DI the snapshot does not know.
 */
export function changedEnds(snap: Snapshot, edge: El): ChangedEnd[] {
  const old = snap.byDi.get(edge);
  if (!old || (old.kind !== 'sequenceFlow' && old.kind !== 'messageFlow')) return [];
  const el = raw<El>(edge, 'bpmnElement');
  if (!el) return [];
  const now = edgeEnds(el);
  const out: ChangedEnd[] = [];
  if (endNow(snap, old.sourceId) !== now.sourceId) out.push({ end: 'source', id: now.sourceId ?? '' });
  if (endNow(snap, old.targetId) !== now.targetId) out.push({ end: 'target', id: now.targetId ?? '' });
  return out;
}

/** The id now of an end known by its id before the ops: follows `set id=` and a retype (model/ChangeSet.ts successorOf), so a retyped and renamed end is still the same end. */
function endNow(snap: Snapshot, oldId: string | undefined): string | undefined {
  const el = oldId === undefined ? undefined : snap.els.get(oldId);
  return (el && idOf(successorOf(el))) ?? oldId;
}

/**
 * Deletes the BPMNEdge of every flow whose ends the ops changed (changedEnds)
 * when it shows the old ends: an edge whose end points already reach the
 * shapes of the new ends on its plane (within DETACHED_GAP, the detachedEnds
 * rule) stays. `further: true` only in the further views of a root (a second
 * BPMNDiagram of it, which the incremental layout never draws); else in every
 * diagram, where on the first diagram of a root an edge also stays when a new
 * end of its flow has no shape there (a node added with --no-layout: the next
 * write places it and routes the flow again, and an engine drawing stays
 * engine-owned). Returns the flows' ids.
 */
export function pruneReEnded(defs: El, snap: Snapshot, opts: { further?: boolean } = {}): string[] {
  const drawn = new Map<El, Map<string, Box>>();
  const boundsOn = (plane: El): Map<string, Box> => {
    let shapes = drawn.get(plane);
    if (!shapes) {
      drawn.set(plane, (shapes = new Map()));
      for (const pe of rawList(plane, 'planeElement')) {
        const id = is(pe, 'bpmndi:BPMNShape') ? idOf(raw(pe, 'bpmnElement')) : undefined;
        const b = id ? boxOf(raw(pe, 'bounds')) : undefined;
        if (id && b && !shapes.has(id)) shapes.set(id, b);
      }
    }
    return shapes;
  };
  return pruneEdges(defs, (edge, plane, further) => {
    if (opts.further && !further) return false;
    const ends = changedEnds(snap, edge);
    if (!ends.length) return false;
    const shapes = boundsOn(plane);
    if (!further && ends.some((c) => c.id && !shapes.has(c.id))) return false;
    const pts = rawList(edge, 'waypoint').map((w) => ({ x: raw<number>(w, 'x') ?? 0, y: raw<number>(w, 'y') ?? 0 }));
    const reached = (c: ChangedEnd): boolean => {
      const b = c.id ? shapes.get(c.id) : undefined;
      const p = c.end === 'source' ? pts[0] : pts[pts.length - 1];
      return !!b && !!p && pts.length >= 2 && containsPoint(b, p, DETACHED_GAP);
    };
    return !ends.every(reached);
  });
}

/* ------------------------------------------------------------------ */
/* engine ownership                                                     */
/* ------------------------------------------------------------------ */

/** Bounds of every flow node shape of all diagrams, by element id. */
export function flowNodeBoxes(defs: El): Map<string, Box> {
  const out = new Map<string, Box>();
  for (const plane of readPlanes(defs)) {
    for (const s of plane.shapes.values()) if (is(s.el, 'bpmn:FlowNode')) out.set(s.id, s.bounds);
  }
  return out;
}

/**
 * Everything a drawing shows, by `plane root|element id`: the bounds and
 * label of every shape (flow nodes, artifacts, pools, lanes, groups) and the
 * waypoints and label of every connection.
 */
export interface DiagramGeometry {
  shapes: Map<string, { bounds: Box; label?: Box; flowNode: boolean }>;
  edges: Map<string, { points: Point[]; label?: Box }>;
}

export function diagramGeometry(defs: El): DiagramGeometry {
  const out: DiagramGeometry = { shapes: new Map(), edges: new Map() };
  for (const plane of readPlanes(defs)) {
    for (const s of plane.shapes.values()) out.shapes.set(`${plane.rootId}|${s.id}`, { bounds: s.bounds, ...(s.label ? { label: s.label } : {}), flowNode: is(s.el, 'bpmn:FlowNode') });
    for (const e of plane.edges.values()) out.edges.set(`${plane.rootId}|${e.id}`, { points: e.points, ...(e.label ? { label: e.label } : {}) });
  }
  return out;
}

/**
 * True when the drawing `mine` is what the engine drew in `laidOut`: the same
 * shapes and connections, every bound, label and waypoint within `tol` px. A
 * moved annotation, a hand bend, a dragged label or a resized pool (also
 * from a format op such as route or label) makes it hand-made.
 */
export function engineOwned(mine: DiagramGeometry, laidOut: El, tol = 2): boolean {
  const theirs = diagramGeometry(laidOut);
  if (![...mine.shapes.values()].some((s) => s.flowNode)) return false;
  if (mine.shapes.size !== theirs.shapes.size || mine.edges.size !== theirs.edges.size) return false;
  const sameLabel = (a: Box | undefined, b: Box | undefined): boolean => (!a && !b) || (!!a && !!b && sameBox(a, b, tol));
  for (const [key, s] of mine.shapes) {
    const t = theirs.shapes.get(key);
    if (!t || !sameBox(s.bounds, t.bounds, tol) || !sameLabel(s.label, t.label)) return false;
  }
  for (const [key, e] of mine.edges) {
    const t = theirs.edges.get(key);
    if (!t || t.points.length !== e.points.length || !sameLabel(e.label, t.label)) return false;
    if (e.points.some((p, i) => Math.abs(p.x - t.points[i]!.x) > tol || Math.abs(p.y - t.points[i]!.y) > tol)) return false;
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* report                                                               */
/* ------------------------------------------------------------------ */

export interface IncrementalReport {
  mode: 'incremental';
  placed: string[];
  moved: string[];
  rerouted: string[];
  /** pre-existing connections whose waypoints changed without being routed again (the space tool stretched them) */
  reshaped: string[];
  pruned: string[];
  notes: string[];
}

export interface IncrementalOptions {
  /** nodes the ops re-inserted elsewhere in the flow (move --after/--before/--flow/--in) */
  relocated?: Iterable<string>;
  /** ids the ops created, in op order: new nodes are placed in that order where their neighbours allow (like single commands) */
  created?: readonly string[];
  /** sub-processes to draw expanded / collapsed */
  expand?: Iterable<string>;
  collapse?: Iterable<string>;
}

/* ------------------------------------------------------------------ */
/* helpers                                                              */
/* ------------------------------------------------------------------ */

/** Flow nodes, artifacts and connections of the model, parents before children. */
function modelOrder(defs: El): El[] {
  const out: El[] = [];
  const visitScope = (scope: El): void => {
    for (const fe of rawList(scope, 'flowElements')) {
      out.push(fe);
      for (const da of [...rawList(fe, 'dataInputAssociations'), ...rawList(fe, 'dataOutputAssociations')]) out.push(da);
      if (isSubProcess(fe)) visitScope(fe);
    }
    for (const a of rawList(scope, 'artifacts')) out.push(a);
  };
  for (const root of rawList(defs, 'rootElements')) {
    if (is(root, 'bpmn:Collaboration')) {
      for (const p of rawList(root, 'participants')) out.push(p);
      for (const m of rawList(root, 'messageFlows')) out.push(m);
      for (const a of rawList(root, 'artifacts')) out.push(a);
    }
  }
  for (const root of rawList(defs, 'rootElements')) {
    if (!is(root, 'bpmn:Process')) continue;
    const lanes = (ls: El[]): void => {
      for (const set of ls) {
        for (const lane of rawList(set, 'lanes')) {
          out.push(lane);
          const child = raw<El>(lane, 'childLaneSet');
          if (child) lanes([child]);
        }
      }
    };
    lanes(rawList(root, 'laneSets'));
    visitScope(root);
  }
  return out;
}

function shapeIndex(planes: readonly Plane[]): Map<string, { plane: Plane; shape: DShape }> {
  const out = new Map<string, { plane: Plane; shape: DShape }>();
  for (const plane of planes) for (const s of plane.shapes.values()) out.set(s.id, { plane, shape: s });
  return out;
}

function edgeIndex(planes: readonly Plane[]): Map<string, { plane: Plane; edge: DEdge }> {
  const out = new Map<string, { plane: Plane; edge: DEdge }>();
  for (const plane of planes) for (const e of plane.edges.values()) out.set(e.id, { plane, edge: e });
  return out;
}

const isFlowNode = (el: El): boolean => is(el, 'bpmn:FlowNode');
const isArtifactShape = (el: El): boolean => is(el, 'bpmn:DataObjectReference') || is(el, 'bpmn:DataStoreReference') || is(el, 'bpmn:TextAnnotation');
const isConnection = (el: El): boolean => is(el, 'bpmn:SequenceFlow') || is(el, 'bpmn:MessageFlow') || is(el, 'bpmn:Association') || is(el, 'bpmn:DataAssociation');

/* ------------------------------------------------------------------ */
/* blocks laid out by the clean engine                                  */
/* ------------------------------------------------------------------ */

interface Block {
  /** bounds of the block root in the engine drawing */
  box: Box;
  shapes: DShape[];
  edges: DEdge[];
  /** whole planes (collapsed sub-processes inside the block) */
  planes: Plane[];
}

async function enginePlanes(doc: Doc, opts: IncrementalOptions): Promise<{ planes: Plane[]; sem: Semantics }> {
  const model = await parseXml(await doc.toXml());
  const expanded = resolveExpanded(model, { expand: opts.expand ?? [], collapse: opts.collapse ?? [] });
  layoutClean(model, expanded);
  const sem = semantics(model.definitions);
  return { planes: readPlanes(model.definitions, sem), sem };
}

function descendantOf(sem: Semantics, id: string, ancestor: string): boolean {
  let scope = sem.scopeOf.get(id);
  for (let i = 0; scope && i < 50; i++) {
    if (idOf(scope) === ancestor) return true;
    scope = sem.scopeOf.get(idOf(scope) ?? '');
  }
  return false;
}

function blockOf(engine: { planes: Plane[]; sem: Semantics }, rootId: string, pool: boolean): Block | undefined {
  const plane = engine.planes.find((p) => p.shapes.has(rootId));
  const root = plane?.shapes.get(rootId);
  if (!plane || !root) return undefined;
  let shapes: DShape[];
  let edges: DEdge[];
  if (pool) {
    shapes = [...plane.shapes.values()].filter((s) => s.id !== rootId && s.poolId === rootId);
    const inside = new Set(shapes.map((s) => s.id));
    edges = [...plane.edges.values()].filter((e) => e.kind !== 'messageFlow' && ((e.sourceId && inside.has(e.sourceId)) || (e.targetId && inside.has(e.targetId))));
  } else {
    ({ shapes, edges } = contentOf(plane, rootId));
  }
  const planes = engine.planes.filter((p) => p !== plane && (pool ? engine.sem.poolOfProcess.get(idOf(processOfScope(engine.sem, p.rootId)) ?? '') === rootId : descendantOf(engine.sem, p.rootId, rootId)));
  return { box: copyBox(root.bounds), shapes, edges, planes };
}

function processOfScope(sem: Semantics, id: string): El | undefined {
  let el: El | undefined = sem.byId.get(id);
  for (let i = 0; el && i < 50 && !is(el, 'bpmn:Process'); i++) el = sem.scopeOf.get(idOf(el) ?? '');
  return el;
}

/** Copies engine geometry onto `plane` (shifted by dx/dy), rebinding to the document's elements. */
function adoptBlock(ctx: Ctx, plane: Plane, block: Block, dx: number, dy: number): void {
  const rebindShape = (s: DShape, target: Plane, ox: number, oy: number): void => {
    const el = ctx.sem.byId.get(s.id);
    if (!el || target.shapes.has(s.id)) return;
    const copy = newShape(ctx.place, target, s.id, { x: s.bounds.x + ox, y: s.bounds.y + oy, width: s.bounds.width, height: s.bounds.height });
    if (s.label) copy.label = { ...s.label, x: s.label.x + ox, y: s.label.y + oy };
    if (s.kind === 'subProcess') {
      copy.expanded = s.expanded === true;
      copy.container = s.expanded === true;
    }
    target.shapes.set(s.id, copy);
    ctx.place.placed.add(s.id);
    ctx.fromEngine.add(s.id);
  };
  const rebindEdge = (e: DEdge, target: Plane, ox: number, oy: number): void => {
    const el = ctx.sem.byId.get(e.id);
    if (!el || target.edges.has(e.id)) return;
    const copy: DEdge = { id: e.id, el, kind: edgeKind(el), ...edgeEnds(el), points: e.points.map((p) => ({ x: p.x + ox, y: p.y + oy })) };
    if (e.label) copy.label = { ...e.label, x: e.label.x + ox, y: e.label.y + oy };
    target.edges.set(e.id, copy);
    ctx.fromEngine.add(e.id);
    ctx.newEdges.add(e.id);
  };
  // containers first so the content's membership (parentId) resolves
  for (const s of [...block.shapes].sort((a, b) => Number(b.container) - Number(a.container))) rebindShape(s, plane, dx, dy);
  for (const s of plane.shapes.values()) {
    if (!ctx.fromEngine.has(s.id)) continue;
    const scope = ctx.sem.scopeOf.get(s.id);
    const sid = idOf(scope);
    if (scope && sid && isSubProcess(scope) && plane.shapes.get(sid)?.expanded) s.parentId = sid;
  }
  for (const e of block.edges) rebindEdge(e, plane, dx, dy);
  for (const p of block.planes) {
    const root = ctx.sem.byId.get(p.rootId);
    if (!root || ctx.planes.some((q) => q.rootId === p.rootId)) continue;
    const target: Plane = { id: `BPMNPlane_${p.rootId}`, rootId: p.rootId, root, shapes: new Map(), edges: new Map(), dropped: [] };
    ctx.planes.push(target);
    for (const s of p.shapes.values()) rebindShape(s, target, 0, 0);
    for (const e of p.edges.values()) rebindEdge(e, target, 0, 0);
  }
}

/* ------------------------------------------------------------------ */
/* the run                                                              */
/* ------------------------------------------------------------------ */

interface Ctx {
  doc: Doc;
  sem: Semantics;
  snap: Snapshot;
  planes: Plane[];
  place: PlaceCtx;
  /** edges (by id) that must be (re)routed */
  reroute: Set<string>;
  /** connections created in this run */
  newEdges: Set<string>;
  /** shapes / edges copied from the engine (already laid out) */
  fromEngine: Set<string>;
  /** nodes that moved for a semantic reason (lane change, relocation, resize) */
  active: Set<string>;
  /** nodes re-inserted elsewhere (placed again, reported as moved) */
  relocated: Set<string>;
  /** activities grown to fit their name */
  grown: Set<string>;
  /** shape bounds before anything moved */
  baseline: Map<string, Box>;
  /** ids the ops created, in op order (IncrementalOptions.created) */
  created: readonly string[];
  /** flows routed when their second end was placed (routeNow): their state then, to tell whether they broke since */
  routedNow: Map<string, EdgeBefore>;
  /** every connection's state before anything moved (brokenEdge) */
  edgesBefore: Map<DEdge, EdgeBefore>;
  notes: string[];
}

/** The id an element had before the ops (its DI is the same object even when `set id=` renamed it). */
function oldId(ctx: Ctx, x: DShape | DEdge): string {
  return (x.di && ctx.snap.byDi.get(x.di)?.id) || x.id;
}

/** The id now of an element known by its id before the ops. */
function cur(ctx: Ctx, id: string | undefined): string | undefined {
  return currentId(ctx.snap, id);
}

function planeOfDi(planes: readonly Plane[], planeDi: El | undefined): Plane | undefined {
  return planeDi ? planes.find((p) => p.di === planeDi) : undefined;
}

/** A plane for a collapsed sub-process that has none yet. */
function ensurePlane(ctx: Ctx, id: string): Plane | undefined {
  const home = homePlane(ctx.planes, ctx.sem, id);
  if (home) return home;
  const el = ctx.sem.byId.get(id);
  if (!el) return undefined;
  const anchor = is(el, 'bpmn:DataAssociation') ? idOf(el.$parent) : id;
  const scope = anchor ? ctx.sem.scopeOf.get(anchor) : undefined;
  const sid = idOf(scope);
  if (!scope || !sid || !isSubProcess(scope)) return undefined;
  // only for a sub-process drawn collapsed (a pending one that will be expanded gets its content later)
  const shape = ctx.planes.map((p) => p.shapes.get(sid)).find((x) => !!x);
  if (shape?.expanded) return undefined;
  if (!shape && !(ctx.place.collapsed.has(sid) && ensurePlane(ctx, sid))) return undefined;
  const plane: Plane = { id: `BPMNPlane_${sid}`, rootId: sid, root: scope, shapes: new Map(), edges: new Map(), dropped: [] };
  ctx.planes.push(plane);
  return plane;
}

/** Re-points the root plane at a new collaboration; returns the participant wrapping the old root process. */
function followRoot(ctx: Ctx): string | undefined {
  const root = layoutRoot(ctx.doc.definitions);
  const rootId = idOf(root);
  if (!root || !rootId || rootId === ctx.snap.rootId || !is(root, 'bpmn:Collaboration')) return undefined;
  const old = ctx.planes.find((p) => p.rootId === ctx.snap.rootId);
  if (!old || ctx.planes.some((p) => p.rootId === rootId)) return undefined;
  old.root = root;
  old.rootId = rootId;
  const wrapper = rawList(root, 'participants').find((p) => idOf(raw(p, 'processRef')) === ctx.snap.rootId);
  // the content now belongs to a pool: refresh membership
  const poolId = idOf(wrapper);
  if (poolId) for (const s of old.shapes.values()) if (!s.poolId && s.kind !== 'participant') s.poolId = poolId;
  return poolId;
}

function removedAndRelocated(ctx: Ctx, relocated: Set<string>): Array<{ plane: Plane; box: Box; poolId?: string; parentId?: string }> {
  const strips: Array<{ plane: Plane; box: Box; poolId?: string; parentId?: string }> = [];
  const live = new Set<El>();
  for (const p of ctx.planes) {
    for (const s of p.shapes.values()) if (s.di) live.add(s.di);
    for (const e of p.edges.values()) if (e.di) live.add(e.di);
  }
  for (const [di, entry] of ctx.snap.byDi) {
    if (live.has(di) || !entry.bounds) continue;
    const plane = planeOfDi(ctx.planes, entry.planeDi);
    if (!plane) continue;
    if (entry.kind === 'lane') {
      removedLane(plane, entry.bounds, entry.poolId, entry.laneId, ctx.place.moved);
      continue;
    }
    if (entry.kind === 'participant') {
      removedPool(plane, entry.bounds, ctx.place.moved);
      continue;
    }
    const flowNode = ['task', 'subProcess', 'event', 'gateway'].includes(entry.kind);
    const poolId = cur(ctx, entry.poolId);
    const parentId = cur(ctx, entry.parentId);
    const frameGone = (poolId && !plane.shapes.has(poolId)) || (parentId && !plane.shapes.has(parentId));
    if (flowNode && !frameGone) strips.push({ plane, box: entry.bounds, ...(poolId ? { poolId } : {}), ...(parentId ? { parentId } : {}) });
  }
  // nodes that left their place in the flow, their scope or their plane; boundary events moved to another host
  for (const plane of ctx.planes) {
    for (const s of [...plane.shapes.values()]) {
      if (!isFlowNode(s.el)) continue;
      if (s.kind === 'boundary') {
        const hostBefore = cur(ctx, ctx.snap.hostOf.get(oldId(ctx, s)));
        if (!s.di || !ctx.snap.byDi.has(s.di) || hostBefore === undefined || hostBefore === s.hostId || !plane.shapes.has(s.id)) continue;
        // re-attached (`move --on`): placed again on the new host, its DI reused
        plane.shapes.delete(s.id);
        ctx.place.reuse.set(s.id, { shape: s, boundaries: [], from: plane });
        ctx.relocated.add(s.id);
        for (const e of plane.edges.values()) if (e.sourceId === s.id || e.targetId === s.id) ctx.reroute.add(e.id);
        continue;
      }
      // compared by the ids now: renaming a process or sub-process (`set id=`) relocates nothing
      const scopeNow = idOf(ctx.sem.scopeOf.get(s.id));
      const scopeBefore = cur(ctx, ctx.snap.scopeOf.get(oldId(ctx, s)));
      const home = homePlane(ctx.planes, ctx.sem, s.id);
      if (!relocated.has(s.id) && scopeNow === scopeBefore && (!home || home === plane)) continue;
      const boundaries = [...plane.shapes.values()].filter((b) => b.hostId === s.id);
      const content = s.kind === 'subProcess' && s.expanded ? contentOf(plane, s.id) : undefined;
      plane.shapes.delete(s.id);
      for (const b of boundaries) plane.shapes.delete(b.id);
      for (const c of content?.shapes ?? []) plane.shapes.delete(c.id);
      ctx.place.reuse.set(s.id, { shape: s, boundaries, from: plane, ...(content ? { content } : {}) });
      ctx.relocated.add(s.id);
      // the strip is where the node was: in the frame it had before the ops (it may have moved into another one)
      const was = s.di ? ctx.snap.byDi.get(s.di) : undefined;
      const poolId = was ? cur(ctx, was.poolId) : s.poolId;
      const parentId = was ? cur(ctx, was.parentId) : s.parentId;
      strips.push({ plane, box: copyBox(s.bounds), ...(poolId ? { poolId } : {}), ...(parentId ? { parentId } : {}) });
      const own = new Set([s.id, ...boundaries.map((b) => b.id)]);
      const inner = new Set(content?.edges.map((e) => e.id) ?? []);
      for (const e of plane.edges.values()) {
        if (inner.has(e.id)) continue;
        if ((e.sourceId && own.has(e.sourceId)) || (e.targetId && own.has(e.targetId))) ctx.reroute.add(e.id);
      }
    }
  }
  return strips;
}

function closeStrips(ctx: Ctx, strips: Array<{ plane: Plane; box: Box; poolId?: string; parentId?: string }>, ignore: Set<string>): void {
  const sorted = [...strips].sort((a, b) => b.box.x - a.box.x);
  for (const st of sorted) {
    const sp = ctx.place.spacing.get(st.plane) ?? spacingOf(st.plane);
    const frame = st.parentId ? st.plane.shapes.get(st.parentId) : st.poolId ? st.plane.shapes.get(st.poolId) : undefined;
    const from = st.box.x - sp.gap;
    const to = right(st.box) + sp.gap;
    const band = frame?.bounds;
    // inside an expanded sub-process only its own content closes up (the sub-process shrinks); what is drawn outside it stays
    const sub = frame?.kind === 'subProcess' ? frame : undefined;
    const keep = sub ? new Set([...st.plane.shapes.values()].filter((s) => s !== sub && s.hostId !== sub.id && !inFrame(st.plane, s, sub)).map((s) => s.id)) : undefined;
    // nothing to pull back: leave the frame as it is
    const beyond = [...st.plane.shapes.values()].some((s) => isLeaf(s) && s.bounds.x >= to && (!band || (cy(s.bounds) >= band.y && cy(s.bounds) <= band.y + band.height)) && !keep?.has(s.id));
    if (!beyond) continue;
    const r = closeStrip(st.plane, { axis: 'x', from, to, gap: sp.gap, ignore, ...(band ? { within: { ...band } } : {}), ...(keep ? { keep } : {}) }) ?? (sub ? undefined : closeRow(st.plane, st.box, frame, from, to, sp.gap, ignore));
    if (LayoutDebug.on()) LayoutDebug.log(`[strip] x ${Math.round(from)}..${Math.round(to)}${band ? ` in ${frame!.id}` : ''}: ${r ? `closed, moved ${[...r.moved].join(',')}` : 'kept'}`);
    if (r) r.moved.forEach((x) => ctx.place.moved.add(x));
  }
}

/**
 * The strip of a removed node closes within its row only (module contract,
 * step 2): what lies on the row beyond the strip moves back, unless a moved
 * shape would come within 10 px of one that stays (a shape partly in the row,
 * a shape of another row reaching over it; a moved expanded sub-process
 * whose border reaches into another row), would cross the border of a group
 * or frame that stays, or a connection would join a moved shape to one that
 * stays beyond the strip in the frame (what a full close would have moved
 * along) or to an artifact that stays.
 */
function closeRow(plane: Plane, box: Box, frame: DShape | undefined, from: number, to: number, gap: number, ignore: ReadonlySet<string>): ReturnType<typeof closeStrip> {
  const pad = 10;
  const fb = frame?.bounds;
  const row: Box = { x: fb ? fb.x : -1e7, y: box.y - pad, width: fb ? fb.width : 2e7, height: box.height + 2 * pad };
  const onRow = [...plane.shapes.values()].filter((s) => isLeaf(s) && s.bounds.y < row.y + row.height && s.bounds.y + s.bounds.height > row.y && (!fb || (s.bounds.x >= fb.x && s.bounds.x <= right(fb))));
  // the strip on this row ends where the next shape starts (the drawing's gap there may be smaller than the median)
  const end = Math.min(to, ...onRow.filter((s) => s.bounds.x >= right(box) - 1).map((s) => s.bounds.x));
  if (!onRow.some((s) => s.bounds.x >= end - 3)) return undefined;
  const saved = new PlaneCheckpoint(plane);
  const r = closeStrip(plane, { axis: 'x', from, to: end, gap, ignore, within: row });
  if (!r) return undefined;
  const leaves = [...plane.shapes.values()].filter(isLeaf);
  const before = (s: DShape): Box => saved.boundsOf(s);
  const moved = leaves.filter((m) => r.moved.has(m.id));
  const clash = moved.some((m) => leaves.some((o) => !r.moved.has(o.id) && o.id !== m.hostId && o.hostId !== m.id && overlaps(m.bounds, o.bounds, 10) && !overlaps(before(m), before(o), 10)));
  // a moved expanded sub-process must not come over a shape that stays (a shape of another row below its border)
  const covers = [...plane.shapes.values()].some(
    (f) => f.container && f.kind === 'subProcess' && r.moved.has(f.id) && leaves.some((o) => !r.moved.has(o.id) && o.hostId !== f.id && overlaps(f.bounds, o.bounds, 10) && !overlaps(before(f), before(o), 10)),
  );
  // inside / across / outside a group or frame that stayed
  const relation = (b: Box, f: Box): number => (inside(b, f) ? 2 : overlaps(b, f) ? 1 : 0);
  const frames = [...plane.shapes.values()].filter((f) => (f.kind === 'group' || f.container) && !r.moved.has(f.id));
  const crossed = moved.some((m) => frames.some((f) => relation(m.bounds, f.bounds) !== relation(before(m), f.bounds)));
  // a moved shape stays connected to what a full close would have moved too (beyond the strip, in the frame) and to its artifacts
  const behind = (id: string): boolean => {
    const o = plane.shapes.get(id);
    if (!o) return false;
    const c = o.bounds.y + o.bounds.height / 2;
    return o.bounds.x >= end - 3 && (!fb || (c >= fb.y && c <= fb.y + fb.height));
  };
  const tethered = [...plane.edges.values()].some((e) => {
    if (!e.sourceId || !e.targetId || r.moved.has(e.sourceId) === r.moved.has(e.targetId)) return false;
    const stayed = r.moved.has(e.sourceId) ? e.targetId : e.sourceId;
    return e.kind === 'association' || e.kind === 'dataAssociation' || behind(stayed);
  });
  if (clash || covers || crossed || tethered || r.resized.size) {
    saved.restore();
    return undefined;
  }
  return r;
}

/**
 * A sub-process retyped to a task keeps its DI with isExpanded: it becomes
 * task-sized on its row and the freed strip closes (the same as resizing
 * around the centre and closing the strips on both sides).
 */
function shrinkRetyped(ctx: Ctx, plane: Plane, s: DShape): void {
  const old = s.di ? ctx.snap.byDi.get(s.di) : undefined;
  if (s.kind === 'subProcess' || !old?.expanded || !s.di) return;
  const before = copyBox(s.bounds);
  s.bounds = { x: before.x, y: Math.round(cy(before) - SIZES.task.height / 2), ...SIZES.task };
  s.di.set('isExpanded', undefined);
  s.container = false;
  reseatBoundaries(plane, s, before, ctx.place.moved);
  ctx.active.add(s.id);
  const sp = ctx.place.spacing.get(plane) ?? spacingOf(plane);
  const band = s.poolId ? plane.shapes.get(s.poolId)?.bounds : undefined;
  const own = new Set([...plane.edges.values()].filter((e) => e.sourceId === s.id || e.targetId === s.id).map((e) => e.id));
  const r = closeStrip(plane, { axis: 'x', from: right(s.bounds), to: right(before) + sp.gap, gap: sp.gap, ignore: own, ...(band ? { within: { ...band } } : {}) });
  r?.moved.forEach((x) => ctx.place.moved.add(x));
  own.forEach((id) => ctx.reroute.add(id));
}

/** Sub-processes whose requested expansion differs from their drawing are collapsed / expanded. */
function applyExpansion(ctx: Ctx, opts: IncrementalOptions): void {
  const want = new Map<string, boolean>();
  for (const id of opts.expand ?? []) want.set(id, true);
  for (const id of opts.collapse ?? []) want.set(id, false);
  for (const plane of [...ctx.planes]) {
    for (const s of [...plane.shapes.values()]) {
      if (s.kind !== 'subProcess') {
        shrinkRetyped(ctx, plane, s);
        continue;
      }
      const desired = want.get(s.id);
      if (desired === undefined || desired === (s.expanded === true)) continue;
      const sp = ctx.place.spacing.get(plane) ?? spacingOf(plane);
      if (!desired) {
        let child = ctx.planes.find((p) => p.rootId === s.id);
        if (!child) {
          child = { id: `BPMNPlane_${s.id}`, rootId: s.id, root: s.el, shapes: new Map(), edges: new Map(), dropped: [] };
          ctx.planes.push(child);
        }
        collapse(plane, s, child, sp.gap, ctx.place.moved);
      } else {
        expand(plane, s, ctx.planes.find((p) => p.rootId === s.id), ctx.sem, ctx.place.moved);
      }
      ctx.active.add(s.id);
      for (const e of plane.edges.values()) if (e.sourceId === s.id || e.targetId === s.id) ctx.reroute.add(e.id);
      ctx.notes.push(`${s.id} drawn ${desired ? 'expanded' : 'collapsed'}`);
    }
  }
}

async function placeContainers(ctx: Ctx, wrapped: string | undefined, blocks: () => Promise<{ planes: Plane[]; sem: Semantics }>): Promise<void> {
  const shapes = shapeIndex(ctx.planes);
  for (const el of modelOrder(ctx.doc.definitions)) {
    const id = idOf(el);
    if (!id || shapes.has(id)) continue;
    if (is(el, 'bpmn:Participant')) {
      const plane = homePlane(ctx.planes, ctx.sem, id);
      if (!plane) continue;
      const s = newShape(ctx.place, plane, id, { x: 0, y: 0, width: 0, height: 0 });
      const proc = raw<El>(el, 'processRef');
      // a new pool whose process has content: the engine lays that content out as one block
      const content = id !== wrapped && proc ? rawList(proc, 'flowElements').filter(isFlowNode) : [];
      const block = content.length ? blockOf(await blocks(), id, true) : undefined;
      if (id === wrapped) wrapPool(plane, s);
      else placePool(plane, s, !proc, block ? { width: block.box.width, height: block.box.height } : undefined);
      plane.shapes.set(id, s);
      if (block) adoptBlock(ctx, plane, block, s.bounds.x - block.box.x, s.bounds.y - block.box.y);
      ctx.place.placed.add(id);
      shapes.set(id, { plane, shape: s });
    } else if (is(el, 'bpmn:Lane')) {
      const plane = homePlane(ctx.planes, ctx.sem, id);
      if (!plane) continue;
      const s = newShape(ctx.place, plane, id, { x: 0, y: 0, width: 0, height: 0 });
      if (!placeLane(plane, s, ctx.place.moved)) {
        ctx.notes.push(`lane ${id} not drawn: its process has no pool in the diagram`);
        continue;
      }
      plane.shapes.set(id, s);
      ctx.place.placed.add(id);
      shapes.set(id, { plane, shape: s });
    }
  }
}

function laneChanges(ctx: Ctx): void {
  for (const plane of ctx.planes) {
    for (const s of [...plane.shapes.values()]) {
      if (!isFlowNode(s.el) || s.kind === 'boundary' || ctx.place.placed.has(s.id)) continue;
      const now = ctx.sem.laneOf.get(s.id);
      if (now === cur(ctx, ctx.snap.laneOf.get(oldId(ctx, s))) || !now) continue;
      if (changeLane(ctx.place, plane, s.id)) ctx.active.add(s.id);
    }
  }
}

/**
 * A join drawn before the ops that a new sequence flow would enter backwards
 * (its centre left of the flow's source, which it does not lead back to: no
 * loop return) is placed again right of its rightmost predecessor, before its
 * one successor S, like a node spliced there (the space tool pushes S and
 * what follows when they are in the way): a `connect` into a merge an earlier
 * command spliced gives the same drawing as the batch that adds the merge and
 * the flow together. Only a gateway with two or more incoming flows and one
 * outgoing flow to S, with its sources and S in its own pool / sub-process
 * and S starting right of the sources; its DI and label are kept, it is
 * reported as moved.
 */
function pullJoins(ctx: Ctx): void {
  const before = new Set([...ctx.snap.flowEnds.keys()].map((id) => currentId(ctx.snap, id)));
  let next: Map<string, string[]> | undefined;
  const reaches = (from: string, to: string): boolean => {
    if (!next) {
      next = new Map();
      for (const el of ctx.sem.byId.values()) {
        const ends = is(el, 'bpmn:SequenceFlow') ? edgeEnds(el) : is(el, 'bpmn:BoundaryEvent') ? { sourceId: idOf(raw(el, 'attachedToRef')), targetId: idOf(el) } : undefined;
        if (ends?.sourceId && ends.targetId) next.set(ends.sourceId, [...(next.get(ends.sourceId) ?? []), ends.targetId]);
      }
    }
    const seen = new Set([from]);
    const stack = [from];
    while (stack.length) {
      for (const n of next.get(stack.pop()!) ?? []) {
        if (n === to) return true;
        if (seen.has(n)) continue;
        seen.add(n);
        stack.push(n);
      }
    }
    return false;
  };
  const seqFlows = (el: El | undefined, prop: 'incoming' | 'outgoing'): El[] => rawList(el, prop).filter((f) => is(f, 'bpmn:SequenceFlow'));
  for (const el of ctx.sem.byId.values()) {
    const fid = idOf(el);
    if (!fid || !is(el, 'bpmn:SequenceFlow') || (before.has(fid) && !ctx.place.oldTarget.has(fid))) continue;
    const { sourceId, targetId } = edgeEnds(el);
    const plane = ctx.planes.find((p) => !!targetId && p.shapes.has(targetId));
    const join = targetId ? plane?.shapes.get(targetId) : undefined;
    const source = sourceId ? plane?.shapes.get(sourceId) : undefined;
    if (!plane || !join || !source || !join.di || !ctx.snap.byDi.has(join.di) || ctx.relocated.has(join.id) || ctx.place.joins?.has(join.id)) continue;
    if (!is(join.el, 'bpmn:Gateway') || cx(join.bounds) >= source.bounds.x) continue;
    const ins = seqFlows(join.el, 'incoming');
    const outs = seqFlows(join.el, 'outgoing');
    const S = outs.length === 1 ? plane.shapes.get(idOf(raw(outs[0], 'targetRef')) ?? '') : undefined;
    if (ins.length < 2 || !S || reaches(join.id, source.id)) continue;
    const preds = ins.map((f) => plane.shapes.get(idOf(raw(f, 'sourceRef')) ?? ''));
    const sameFrame = (s: DShape | undefined): boolean => !!s && s.poolId === join.poolId && s.parentId === join.parentId;
    if (!preds.every(sameFrame) || !sameFrame(S) || S.bounds.x <= Math.max(...preds.map((p) => right(p!.bounds)))) continue;
    plane.shapes.delete(join.id);
    ctx.place.reuse.set(join.id, { shape: join, boundaries: [], from: plane });
    (ctx.place.joins ??= new Map()).set(join.id, S.id);
    ctx.relocated.add(join.id);
    for (const e of plane.edges.values()) if (e.sourceId === join.id || e.targetId === join.id) ctx.reroute.add(e.id);
    if (LayoutDebug.on()) LayoutDebug.log(`[join] ${join.id}: ${fid} from ${source.id} would enter it backwards: placed again before ${S.id}`);
  }
}

async function placeNodes(ctx: Ctx, blocks: () => Promise<{ planes: Plane[]; sem: Semantics }>): Promise<void> {
  const drawn = (id: string): boolean => ctx.planes.some((p) => p.shapes.has(id));
  const order = modelOrder(ctx.doc.definitions);
  // new nodes in op order (the model lists an inserted node next to its anchor), the others in model order after them
  const rank = new Map(ctx.created.map((id, i) => [id, i]));
  const pendingNodes = order
    .filter((el) => isFlowNode(el) && idOf(el) && !drawn(idOf(el)!))
    .map((el) => idOf(el)!)
    .map((id, i) => ({ id, key: rank.get(id) ?? ctx.created.length + i }))
    .sort((a, b) => a.key - b.key)
    .map((x) => x.id);
  // new expanded sub-processes with content: one block from the engine
  const blockRoots = pendingNodes.filter((id) => {
    const el = ctx.sem.byId.get(id)!;
    return isSubProcess(el) && !ctx.place.collapsed.has(id) && rawList(el, 'flowElements').some(isFlowNode) && !ctx.place.reuse.has(id);
  });
  const inBlock = new Set<string>();
  const blocksByRoot = new Map<string, Block>();
  if (blockRoots.length) {
    const engine = await blocks();
    for (const root of blockRoots) {
      if (inBlock.has(root)) continue;
      const block = blockOf(engine, root, false);
      if (!block) continue;
      ctx.place.blockSize.set(root, { width: block.box.width, height: block.box.height });
      for (const s of block.shapes) inBlock.add(s.id);
      for (const p of block.planes) for (const s of p.shapes.values()) inBlock.add(s.id);
      blocksByRoot.set(root, block);
    }
  }
  // collapsed sub-processes whose content has no DI at all: their own diagram from the engine
  for (const id of pendingNodes) {
    const scope = ctx.sem.scopeOf.get(id);
    const sid = idOf(scope);
    if (!scope || !sid || !isSubProcess(scope) || inBlock.has(id) || ctx.planes.some((p) => p.rootId === sid)) continue;
    const shape = ctx.planes.map((p) => p.shapes.get(sid)).find((x) => !!x);
    if (shape ? shape.expanded : !ctx.place.collapsed.has(sid)) continue;
    if (rawList(scope, 'flowElements').some((fe) => isFlowNode(fe) && drawn(idOf(fe) ?? ''))) continue;
    const enginePlane = (await blocks()).planes.find((p) => p.rootId === sid);
    if (!enginePlane) continue;
    adoptBlock(ctx, ctx.planes[0]!, { box: { x: 0, y: 0, width: 0, height: 0 }, shapes: [], edges: [], planes: [enginePlane] }, 0, 0);
    for (const s of enginePlane.shapes.values()) inBlock.add(s.id);
  }
  ctx.place.afterPlace = (plane: Plane, s: DShape): void => {
    const block = blocksByRoot.get(s.id);
    if (block) adoptBlock(ctx, plane, block, s.bounds.x - block.box.x, s.bounds.y - block.box.y);
  };
  ctx.place.afterNode = (plane: Plane, id: string): void => routeNow(ctx, plane, id);
  const skipped = placeFlowNodes(
    ctx.place,
    pendingNodes.filter((id) => !inBlock.has(id)),
  );
  delete ctx.place.afterPlace;
  delete ctx.place.afterNode;
  for (const id of skipped) ctx.notes.push(`${id} not drawn: it belongs to no diagram`);
  for (const el of order) {
    const id = idOf(el);
    if (!id || !isArtifactShape(el) || drawn(id) || inBlock.has(id)) continue;
    if (!placeArtifact(ctx.place, id)) ctx.notes.push(`${id} not drawn: it belongs to no diagram`);
  }
}

/**
 * A node a batch just placed: its sequence flows to nodes drawn on its plane
 * are routed now and labelled, and so is its own external label, so that the
 * nodes the batch places next see them like the next single command would
 * (the row choice counts crossings, keeps off lines and labels, and the gap
 * and row spacing are measured again); connections the placement broke
 * (brokenEdge; sequence flows, associations and data associations, message
 * flows wait for the end) are routed again too, as at the end of a single
 * command. At the end (step 8) such a flow is routed again only when it
 * broke since (brokenEdge against its state then), like a flow an earlier
 * single command drew.
 */
function routeNow(ctx: Ctx, plane: Plane, id: string): void {
  const s = plane.shapes.get(id);
  const el = ctx.sem.byId.get(id);
  if (!s || !el) return;
  for (const f of [...rawList(el, 'incoming'), ...rawList(el, 'outgoing')]) {
    const fid = idOf(f);
    if (!fid || !is(f, 'bpmn:SequenceFlow')) continue;
    const ends = edgeEnds(f);
    const other = ends.sourceId === id ? ends.targetId : ends.sourceId;
    if (!other || !plane.shapes.has(other) || ctx.planes.some((p) => p !== plane && p.edges.has(fid))) continue;
    let e = plane.edges.get(fid);
    if (!e) {
      e = { id: fid, el: f, kind: 'sequenceFlow', ...ends, points: [] };
      plane.edges.set(fid, e);
      ctx.newEdges.add(fid);
    } else {
      e.sourceId = ends.sourceId;
      e.targetId = ends.targetId;
    }
    if (LayoutDebug.on()) LayoutDebug.log(`[route] ${fid}: ${ctx.newEdges.has(fid) ? 'new' : 'end placed'}, routed when ${id} was placed`);
    routeKept(ctx, plane, e);
  }
  // what the placement broke (the space tool, a new shape on a line) is routed again now, like at the end of a single command
  const detached = !verticalBand(plane);
  for (const e of plane.edges.values()) {
    if (e.kind === 'messageFlow' || e.points.length < 2 || e.sourceId === id || e.targetId === id || !e.sourceId || !e.targetId) continue;
    const ends = edgeEnds(e.el);
    // an end that changes later (a flow into a node still to be placed) is routed when that node is placed
    if (ends.sourceId !== e.sourceId || ends.targetId !== e.targetId || !plane.shapes.has(e.sourceId) || !plane.shapes.has(e.targetId)) continue;
    const was = ctx.routedNow.get(e.id) ?? ctx.edgesBefore.get(e);
    if (!was || (!brokenEdge(plane, e, was, { detached }) && !(ctx.place.continued?.has(id) && grazes(plane, e, [id])))) continue;
    if (LayoutDebug.on()) LayoutDebug.log(`[route] ${e.id}: broken when ${id} was placed`);
    routeKept(ctx, plane, e);
  }
  if (!s.label && hasExternalLabel(s) && raw<string>(el, 'name')) placeShapeLabel(plane, s);
  // the next command would measure the drawing's gap and row spacing again, with these flows
  ctx.place.spacing.set(plane, spacingOf(plane));
}

/** Routes a connection during placement (routeNow) and records its state then. */
function routeKept(ctx: Ctx, plane: Plane, e: DEdge): void {
  const pts = routeEdge(plane, e, { lines: routingLines(plane, e.id) });
  if (!pts || pts.length < 2) return;
  e.points = pts;
  if (e.label || raw<string>(e.el, 'name')) placeEdgeLabel(plane, e);
  ctx.routedNow.set(e.id, edgeBefore(plane, e));
}

/** Room kept free below an activity's text for what sits on its bottom border: a marker, boundary events. */
function textRoom(plane: Plane, s: DShape): number {
  const marker = s.kind === 'subProcess' || is(s.el, 'bpmn:CallActivity') || !!raw(s.el, 'loopCharacteristics') || raw<boolean>(s.el, 'isForCompensation') === true;
  const below = boundariesOf(plane, s.id).some((b) => attachedSide(b.bounds, s.bounds) === 'bottom');
  return marker || below ? BOTTOM_ROOM : 0;
}

/**
 * A renamed expanded sub-process whose title now takes more lines than the
 * old one did and reaches down to what is drawn in it under the title
 * (shapes and labels inside the frame below its top border, within the
 * title's width, 4 px below it): the content moves down by the difference,
 * at most by the depth the title gained, the sub-process grows (space tool
 * in frame mode, module contract, step 6).
 */
function growForTitle(ctx: Ctx, plane: Plane, s: DShape): void {
  const title = titleOf(s);
  if (!title) return;
  const old = oldTitle(ctx, s);
  // the depth the title gained (diagram/text.ts titleDepth): its new lines, all of it where none was drawn
  const gained = old ? title.height - old.height : bottom(title) - s.bounds.y;
  if (gained <= 0) return;
  const { shapes, edges } = contentOf(plane, s.id);
  // a message flow's label between the pools is no content, even when the flow leaves a shape in the sub-process
  const under = (b: Box): boolean => b.y >= s.bounds.y && b.y < bottom(s.bounds) && b.x < right(title) + 2 && right(b) > title.x - 2;
  const boxes = [...shapes.flatMap((c) => [c.bounds, ...(c.label ? [c.label] : [])]), ...edges.flatMap((e) => (e.label ? [e.label] : []))].filter(under);
  if (!boxes.length) return;
  const delta = Math.ceil(Math.min(gained, bottom(title) + 4 - Math.min(...boxes.map((b) => b.y))));
  if (delta <= 0) return;
  const r = makeSpace(plane, { axis: 'y', line: s.bounds.y + 1, delta, anchors: [s.id], frame: s.id, within: copyBox(s.bounds) });
  for (const x of [...r.moved, ...r.resized]) ctx.place.moved.add(x);
  ctx.place.moved.add(s.id);
  ctx.notes.push(`${s.id} made ${delta} px of room below its new title`);
}

/** Activities whose new name does not fit their box grow, so do expanded sub-processes for their title (module contract, step 6). */
function growForNames(ctx: Ctx): void {
  for (const plane of ctx.planes) {
    const sp = ctx.place.spacing.get(plane) ?? spacingOf(plane);
    for (const s of [...plane.shapes.values()]) {
      if (ctx.fromEngine.has(s.id) || (s.kind !== 'task' && s.kind !== 'subProcess')) continue;
      const name = raw<string>(s.el, 'name');
      if (!name || name === ctx.snap.names.get(oldId(ctx, s))) continue;
      if (s.container) {
        growForTitle(ctx, plane, s);
        continue;
      }
      const size = activitySize(name, s.bounds, textRoom(plane, s));
      if (!size) continue;
      const old = copyBox(s.bounds);
      const own = new Set([s.id, ...boundariesOf(plane, s.id).map((b) => b.id)]);
      const dw = size.width - old.width;
      if (dw > 0) {
        // what follows on the row keeps the drawing's gap (at most 40 px): else the space tool makes room
        const top = cy(old) - size.height / 2;
        const onRow = (b: Box): boolean => b.y < top + size.height + 10 && bottom(b) > top - 10;
        const next = [...plane.shapes.values()].filter((o) => !own.has(o.id) && (isLeaf(o) || (o.kind === 'subProcess' && o.container && !inFrame(plane, s, o))) && o.bounds.x >= right(old) - 0.5 && onRow(o.bounds));
        const lefts = next.flatMap((o) => [o.bounds.x, ...(o.label && onRow(o.label) && right(o.label) > right(old) ? [Math.max(right(old), o.label.x)] : [])]);
        const free = Math.min(Infinity, ...lefts.map((x) => x - right(old)));
        if (free - dw < Math.min(sp.gap, 40)) {
          // inside a sub-process: frame mode, it never grows over foreign shapes (diagram/space.ts)
          const sub = s.parentId ? plane.shapes.get(s.parentId) : undefined;
          const frame = sub ?? (s.poolId ? plane.shapes.get(s.poolId) : undefined);
          const r = makeSpace(plane, { axis: 'x', line: right(old) + 0.5, delta: dw, keep: own, anchors: [s.id], ...(frame ? { within: copyBox(frame.bounds) } : {}), ...(sub ? { frame: sub.id } : {}) });
          for (const x of [...r.moved, ...r.resized]) ctx.place.moved.add(x);
        }
      }
      s.bounds = { x: old.x, y: Math.round(cy(old) - size.height / 2), width: size.width, height: size.height };
      // never above its frame's interior (fitInFrame grows the frame at the right / bottom)
      const frame = frameOf(plane, s);
      const inner = frame ? frameInterior(frame, 15) : undefined;
      if (inner && s.bounds.y < inner.y) s.bounds.y = Math.round(inner.y);
      reseatBoundaries(plane, s, old, ctx.place.moved);
      for (const x of fitInFrame(plane, s.id, 15).moved) ctx.place.moved.add(x);
      ctx.active.add(s.id);
      ctx.place.moved.add(s.id);
      ctx.grown.add(s.id);
      ctx.notes.push(`${s.id} grew to ${size.width}x${size.height} to fit its name`);
    }
  }
}

function neighbourIds(ctx: Ctx, id: string): string[] {
  return [...predecessors(ctx.sem, id), ...successors(ctx.sem, id)];
}

function separateAll(ctx: Ctx): void {
  const changed = new Set([...ctx.place.placed, ...ctx.active, ...ctx.place.moved]);
  for (const plane of ctx.planes) {
    const active = [...changed].filter((id) => plane.shapes.has(id) && !ctx.fromEngine.has(id));
    if (!active.length) continue;
    const movable = new Set(active);
    for (const id of active) for (const n of neighbourIds(ctx, id)) if (plane.shapes.has(n)) movable.add(n);
    const r = separate(plane, { active: [...active].filter((id) => ctx.place.placed.has(id) || ctx.active.has(id)), movable, baseline: ctx.baseline });
    r.moved.forEach((x) => ctx.place.moved.add(x));
    r.resized.forEach((x) => ctx.place.moved.add(x));
    if (r.unresolved.length) ctx.notes.push(`overlap left: ${r.unresolved.map(([a, b]) => `${a}~${b}`).join(', ')}`);
  }
}

/**
 * A new node placed next to an anchor inside a group may reach over the
 * group's border: the group grows around it (groups are drawn around their
 * content; a node half in, half out reads as neither).
 */
function growGroups(ctx: Ctx): void {
  for (const plane of ctx.planes) {
    const groups = [...plane.shapes.values()].filter((g) => g.kind === 'group');
    if (!groups.length) continue;
    for (const id of ctx.place.placed) {
      const s = plane.shapes.get(id);
      if (!s || !isLeaf(s) || s.kind === 'boundary') continue;
      for (const g of groups) {
        const b = g.bounds;
        if (!overlaps(s.bounds, b) || inside(s.bounds, b, 10)) continue;
        const pad = 15;
        const x = Math.min(b.x, s.bounds.x - pad);
        const y = Math.min(b.y, s.bounds.y - pad);
        g.bounds = { x, y, width: Math.max(right(b), right(s.bounds) + pad) - x, height: Math.max(b.y + b.height, s.bounds.y + s.bounds.height + pad) - y };
        ctx.place.moved.add(g.id);
      }
    }
  }
}

/** Creates DEdges for connections without DI and collects every edge to (re)route. */
function collectEdges(ctx: Ctx, before: Map<DEdge, EdgeBefore>): void {
  const edges = edgeIndex(ctx.planes);
  for (const el of modelOrder(ctx.doc.definitions)) {
    const id = idOf(el);
    if (!id || !isConnection(el)) continue;
    const ends = edgeEnds(el);
    const home = is(el, 'bpmn:MessageFlow') ? homePlane(ctx.planes, ctx.sem, id) : ctx.planes.find((p) => (!ends.sourceId || p.shapes.has(ends.sourceId) || p.edges.has(ends.sourceId)) && (!ends.targetId || p.shapes.has(ends.targetId) || p.edges.has(ends.targetId)));
    const have = edges.get(id);
    if (!home) continue;
    if (have && have.plane !== home) {
      have.plane.edges.delete(id);
      home.edges.set(id, have.edge);
      ctx.reroute.add(id);
    } else if (!have) {
      home.edges.set(id, { id, el, kind: edgeKind(el), ...ends, points: [] });
      ctx.newEdges.add(id);
    }
  }
  for (const plane of ctx.planes) {
    // a line that does not reach its ends is routed again, except where nothing may be routed (vertical pools / lanes: it stays, as drawn)
    const detached = !verticalBand(plane);
    for (const e of plane.edges.values()) {
      if (ctx.fromEngine.has(e.id)) continue;
      // routed when its second end was placed: kept unless it broke since
      const now = ctx.routedNow.get(e.id);
      if (now) {
        const ends = edgeEnds(e.el);
        if (ends.sourceId === e.sourceId && ends.targetId === e.targetId && e.points.length >= 2 && !brokenEdge(plane, e, now, { detached }) && !grazes(plane, e, ctx.place.continued)) continue;
        ctx.reroute.add(e.id);
        if (LayoutDebug.on()) LayoutDebug.log(`[route] ${e.id}: broken after it was routed`);
        continue;
      }
      if (ctx.newEdges.has(e.id)) {
        ctx.reroute.add(e.id);
        continue;
      }
      const old = e.di ? ctx.snap.byDi.get(e.di) : undefined;
      const ends = edgeEnds(e.el);
      e.sourceId = ends.sourceId;
      e.targetId = ends.targetId;
      // the ends compared by their ids now: renaming an end (`set id=`) changes nothing here
      const why =
        old && (cur(ctx, old.sourceId) !== ends.sourceId || cur(ctx, old.targetId) !== ends.targetId)
          ? 'ends changed'
          : (e.sourceId && ctx.place.placed.has(e.sourceId)) || (e.targetId && ctx.place.placed.has(e.targetId))
            ? 'end placed'
            : brokenEdge(plane, e, before.get(e), { detached })
              ? 'broken'
              : grazes(plane, e, ctx.place.continued)
                ? 'runs along a new shape'
                : undefined;
      if (why) {
        ctx.reroute.add(e.id);
        if (LayoutDebug.on()) LayoutDebug.log(`[route] ${e.id}: ${why}`);
      }
    }
  }
}

/**
 * Whether a connection runs along the border of one of `ids` or touches it:
 * no `through` (the line does not enter the box), but it reads as docking
 * on the shape. Checked for the nodes that continue a chain (placed on their
 * anchor's row without a row choice, PlaceCtx.continued: an end event placed
 * on a line an earlier command routed down there). Its own ends, their
 * boundary events and hosts do not count.
 */
function grazes(plane: Plane, e: DEdge, ids: Iterable<string> | undefined): boolean {
  if (!ids || e.points.length < 2) return false;
  const own = new Set<string>();
  for (const end of [e.sourceId, e.targetId]) {
    const s = end ? plane.shapes.get(end) : undefined;
    if (!s) continue;
    own.add(s.id);
    if (s.hostId) own.add(s.hostId);
    for (const b of boundariesOf(plane, s.id)) own.add(b.id);
  }
  for (const id of ids) {
    const s = plane.shapes.get(id);
    if (!s || own.has(id) || !isLeaf(s)) continue;
    for (let i = 0; i + 1 < e.points.length; i++) if (segmentHits(e.points[i]!, e.points[i + 1]!, s.bounds, -1)) return true;
  }
  return false;
}

function routeAll(ctx: Ctx): string[] {
  const rerouted: string[] = [];
  for (const plane of ctx.planes) {
    // message flows after the sequence flows (they cross the pools and should see the final sequence flows), connections docked on a connection last
    const pending = [...plane.edges.values()].filter((e) => ctx.reroute.has(e.id)).sort((a, b) => routeRank(plane, a) - routeRank(plane, b));
    const waiting = new Set(pending.map((e) => e.id));
    for (const e of pending) {
      const lines = routingLines(plane, e.id).filter((l) => ![...waiting].some((id) => plane.edges.get(id)?.points === l));
      const pts = routeEdge(plane, e, { lines });
      waiting.delete(e.id);
      if (!pts || pts.length < 2) {
        if (!e.points.length) {
          plane.edges.delete(e.id);
          ctx.newEdges.delete(e.id);
          ctx.notes.push(`${e.id} not drawn: an end has no shape on its diagram`);
        }
        continue;
      }
      e.points = pts;
      if (e.label || raw<string>(e.el, 'name')) placeEdgeLabel(plane, e);
      if (!ctx.newEdges.has(e.id)) rerouted.push(e.id);
    }
  }
  return rerouted;
}

function labels(ctx: Ctx, routed: ReadonlySet<string>): void {
  for (const plane of ctx.planes) {
    // segments of connections drawn in this run: an existing label they run over steps aside
    const fresh = [...plane.edges.values()].filter((e) => routed.has(e.id)).flatMap((e) => e.points.slice(1).map((q, i) => [e.points[i]!, q] as const));
    const grown = [...ctx.grown].map((id) => plane.shapes.get(id)).filter((g): g is DShape => !!g);
    for (const s of plane.shapes.values()) {
      if (ctx.fromEngine.has(s.id)) continue;
      if ((ctx.place.placed.has(s.id) && !s.label) || (ctx.place.relabel?.has(s.id) && hasExternalLabel(s))) {
        placeShapeLabel(plane, s);
        continue;
      }
      if (s.label && hasExternalLabel(s) && fresh.some(([p, q]) => segmentHits(p, q, s.label!, 1))) {
        placeShapeLabel(plane, s);
        ctx.notes.push(`label of ${s.id} moved off a new line`);
        continue;
      }
      if (s.label && hasExternalLabel(s) && grown.some((g) => g !== s && overlaps(s.label!, g.bounds))) {
        placeShapeLabel(plane, s);
        ctx.notes.push(`label of ${s.id} moved off a grown shape`);
        continue;
      }
      const before = ctx.snap.names.get(oldId(ctx, s));
      const now = raw<string>(s.el, 'name');
      if (now && now !== before) refitLabel(plane, s);
    }
    for (const e of plane.edges.values()) {
      if (ctx.fromEngine.has(e.id) || ctx.reroute.has(e.id)) continue;
      const before = ctx.snap.names.get(oldId(ctx, e));
      const now = raw<string>(e.el, 'name');
      if (now && now !== before) refitLabel(plane, e);
    }
    // a label now on the title of an expanded sub-process that it was clear of (room made under it, a wider new title)
    for (const [id, sub] of clearTitles(plane, (o, sub) => !ctx.fromEngine.has(o.id) && clearOfOldTitle(ctx, o, sub))) ctx.notes.push(`label of ${id} moved off the name of ${sub}`);
  }
}

/** The title an expanded sub-process had before the ops (diagram/text.ts titleBox of its snapshot bounds and name); undefined without one. */
function oldTitle(ctx: Ctx, s: DShape): Box | undefined {
  const was = s.di ? ctx.snap.byDi.get(s.di) : undefined;
  return was?.bounds && was.kind === 'subProcess' && was.expanded === true ? titleBox(was.bounds, ctx.snap.names.get(was.id)) : undefined;
}

/** Whether a label was clear of the title of `sub` before the ops (a label or a title that did not exist was). */
function clearOfOldTitle(ctx: Ctx, owner: DShape | DEdge, sub: DShape): boolean {
  const label = owner.di ? ctx.snap.byDi.get(owner.di)?.label : undefined;
  const title = oldTitle(ctx, sub);
  return !label || !title || !overlaps(label, title);
}

/** at most this many repair trials per write (a reroute or a chain placed again, each measured) */
const REPAIR_TRIALS = 8;
/** of them at most this many chains placed again (each draws the new elements again) */
const CHAIN_RETRIES = 2;

const isHardProblem = (p: LayoutProblem): boolean => p.kind !== 'failed' && WEIGHTS[p.kind] >= 6;

/** Whether two polylines cross (a proper crossing of two segments, like the crossings metric). */
function polylinesCross(a: readonly Point[], b: readonly Point[]): boolean {
  const o = (p: Point, q: Point, r: Point): number => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  for (let i = 0; i + 1 < a.length; i++) {
    for (let j = 0; j + 1 < b.length; j++) {
      const [p, q, r, s] = [a[i]!, a[i + 1]!, b[j]!, b[j + 1]!];
      const o1 = o(p, q, r);
      const o2 = o(p, q, s);
      const o3 = o(r, s, p);
      const o4 = o(r, s, q);
      if (o1 !== o2 && o3 !== o4 && o1 && o2 && o3 && o4) return true;
    }
  }
  return false;
}

/** Every crossing between a connection drawn in this run and an existing one: [new, existing, plane]. */
function newCrossings(ctx: Ctx): Array<[DEdge, DEdge, Plane]> {
  const out: Array<[DEdge, DEdge, Plane]> = [];
  for (const plane of ctx.planes) {
    const fresh = [...plane.edges.values()].filter((e) => ctx.newEdges.has(e.id) && e.points.length >= 2);
    if (!fresh.length) continue;
    const kept = [...plane.edges.values()].filter((e) => !ctx.newEdges.has(e.id) && e.points.length >= 2);
    for (const n of fresh) for (const e of kept) if (polylinesCross(n.points, e.points)) out.push([n, e, plane]);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* checkpoints of the drawing (the local repair places chains again)   */
/* ------------------------------------------------------------------ */

interface Checkpoint {
  planes: Plane[];
  members: Map<Plane, { shapes: DShape[]; edges: DEdge[] }>;
  shapes: Map<DShape, { bounds: Box; label?: Box }>;
  edges: Map<DEdge, { points: Point[]; label?: Box; sourceId?: string; targetId?: string }>;
  place: Pick<PlaceCtx, 'placed' | 'moved' | 'spacing' | 'reuse' | 'blockSize' | 'spliced' | 'joins' | 'relabel' | 'heads' | 'skip' | 'continued'>;
  sets: Pick<Ctx, 'reroute' | 'newEdges' | 'fromEngine' | 'active' | 'relocated' | 'grown' | 'routedNow'>;
  notes: string[];
}

/** Everything the drawing of the new elements (incremental.ts steps 6 to 9) changes, to undo it. */
function checkpoint(ctx: Ctx): Checkpoint {
  const cp: Checkpoint = {
    planes: [...ctx.planes],
    members: new Map(),
    shapes: new Map(),
    edges: new Map(),
    place: {
      placed: new Set(ctx.place.placed),
      moved: new Set(ctx.place.moved),
      spacing: new Map(ctx.place.spacing),
      reuse: new Map(ctx.place.reuse),
      blockSize: new Map(ctx.place.blockSize),
      ...(ctx.place.spliced ? { spliced: new Map(ctx.place.spliced) } : {}),
      ...(ctx.place.joins ? { joins: new Map(ctx.place.joins) } : {}),
      ...(ctx.place.relabel ? { relabel: new Set(ctx.place.relabel) } : {}),
      ...(ctx.place.continued ? { continued: new Set(ctx.place.continued) } : {}),
      ...(ctx.place.heads ? { heads: new Map(ctx.place.heads) } : {}),
      ...(ctx.place.skip ? { skip: new Map(ctx.place.skip) } : {}),
    },
    sets: {
      reroute: new Set(ctx.reroute),
      newEdges: new Set(ctx.newEdges),
      fromEngine: new Set(ctx.fromEngine),
      active: new Set(ctx.active),
      relocated: new Set(ctx.relocated),
      grown: new Set(ctx.grown),
      routedNow: new Map(ctx.routedNow),
    },
    notes: [...ctx.notes],
  };
  const keepShape = (s: DShape): void => {
    if (!cp.shapes.has(s)) cp.shapes.set(s, { bounds: copyBox(s.bounds), ...(s.label ? { label: copyBox(s.label) } : {}) });
  };
  const keepEdge = (e: DEdge): void => {
    if (!cp.edges.has(e)) cp.edges.set(e, { points: copyPoints(e.points), ...(e.label ? { label: copyBox(e.label) } : {}), ...(e.sourceId ? { sourceId: e.sourceId } : {}), ...(e.targetId ? { targetId: e.targetId } : {}) });
  };
  for (const plane of ctx.planes) {
    cp.members.set(plane, { shapes: [...plane.shapes.values()], edges: [...plane.edges.values()] });
    plane.shapes.forEach(keepShape);
    plane.edges.forEach(keepEdge);
  }
  // shapes waiting to be placed again (their DI is reused): their boundary events and content move along
  for (const r of ctx.place.reuse.values()) {
    [r.shape, ...r.boundaries, ...(r.content?.shapes ?? [])].forEach(keepShape);
    (r.content?.edges ?? []).forEach(keepEdge);
  }
  return cp;
}

function restore(ctx: Ctx, cp: Checkpoint): void {
  ctx.planes.length = 0;
  ctx.planes.push(...cp.planes);
  for (const [plane, m] of cp.members) {
    plane.shapes = new Map(m.shapes.map((s) => [s.id, s]));
    plane.edges = new Map(m.edges.map((e) => [e.id, e]));
  }
  for (const [s, g] of cp.shapes) {
    s.bounds = copyBox(g.bounds);
    if (g.label) s.label = copyBox(g.label);
    else delete s.label;
  }
  for (const [e, g] of cp.edges) {
    e.points = copyPoints(g.points);
    if (g.label) e.label = copyBox(g.label);
    else delete e.label;
    if (g.sourceId) e.sourceId = g.sourceId;
    else delete e.sourceId;
    if (g.targetId) e.targetId = g.targetId;
    else delete e.targetId;
  }
  const p = cp.place;
  Object.assign(ctx.place, { placed: new Set(p.placed), moved: new Set(p.moved), spacing: new Map(p.spacing), reuse: new Map(p.reuse), blockSize: new Map(p.blockSize) });
  for (const key of ['spliced', 'joins', 'heads', 'skip'] as const) {
    if (p[key]) ctx.place[key] = new Map(p[key] as Map<string, never>);
    else delete ctx.place[key];
  }
  if (p.relabel) ctx.place.relabel = new Set(p.relabel);
  else delete ctx.place.relabel;
  if (p.continued) ctx.place.continued = new Set(p.continued);
  else delete ctx.place.continued;
  const s = cp.sets;
  Object.assign(ctx, { reroute: new Set(s.reroute), newEdges: new Set(s.newEdges), fromEngine: new Set(s.fromEngine), active: new Set(s.active), relocated: new Set(s.relocated), grown: new Set(s.grown), routedNow: new Map(s.routedNow) });
  ctx.notes.splice(0, ctx.notes.length, ...cp.notes);
}

/** The ids of the shapes and connections of every plane (a chain placed again must draw the same elements). */
function membersOf(ctx: Ctx): string {
  return ctx.planes.map((p) => `${p.rootId}:${[...p.shapes.keys()].sort().join(',')}|${[...p.edges.keys()].sort().join(',')}`).join(';');
}

/**
 * The DI the measurements created for the new elements of a drawing that is
 * replaced (by element id per plane), handed to the elements of the drawing
 * that replaces it: one DI element per element, never a second one.
 */
function takeDi(ctx: Ctx): Map<string, El> {
  const out = new Map<string, El>();
  for (const p of ctx.planes) {
    for (const s of p.shapes.values()) if (s.di) out.set(`${p.rootId}|s|${s.id}`, s.di);
    for (const e of p.edges.values()) if (e.di) out.set(`${p.rootId}|e|${e.id}`, e.di);
  }
  return out;
}

function giveDi(ctx: Ctx, di: ReadonlyMap<string, El>): void {
  for (const p of ctx.planes) {
    for (const x of [...p.shapes.values(), ...p.edges.values()]) {
      if (x.di) continue;
      const d = di.get(`${p.rootId}|${'points' in x ? 'e' : 's'}|${x.id}`);
      if (!d) continue;
      x.di = d;
      // a label the replaced drawing gave it and this one does not
      if (!x.label && raw(d, 'label')) d.set('label', undefined);
    }
  }
}

/**
 * The head of the chain a new connection belongs to: a node placed in this
 * run at the cheapest of several row candidates (a branch or exception path,
 * PlaceCtx.heads), found back from the connection's ends through nodes
 * placed in this run.
 */
function chainHead(ctx: Ctx, from: readonly (string | undefined)[]): string | undefined {
  const heads = ctx.place.heads;
  if (!heads?.size) return undefined;
  const seen = new Set<string>();
  const queue = from.filter((x): x is string => !!x && ctx.place.placed.has(x));
  while (queue.length && seen.size < 30) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    if (heads.has(id)) return id;
    for (const p of predecessors(ctx.sem, id)) if (ctx.place.placed.has(p)) queue.push(p);
  }
  return undefined;
}

/**
 * Local repair after placement (issue #18 (3)), at most REPAIR_TRIALS trials
 * per write, for every crossing between a connection drawn in this run and
 * an existing one:
 *  1. the new connection is routed again with the whole drawing in place
 *     (the hand drawing stays as it is), else the existing one, with the new
 *     shapes as obstacles;
 *  2. a crossing left: the chain the new connection belongs to (a branch or
 *     exception path, PlaceCtx.heads) starts at its next row candidate
 *     instead: the new elements are drawn again from the checkpoint taken
 *     before them (`start`, by `redraw`), at most CHAIN_RETRIES times.
 * A trial is kept only under the guard `compact` uses: it adds no hard layout
 * problem (nor a crossing between two connections drawn before this run) and
 * lowers the score (the drawing is measured after each trial, its
 * planes written to the DI first; a chain drawn again takes over the DI the
 * measurement created for the new elements). An existing connection kept
 * rerouted is reported in `rerouted` and in a note, a chain placed again in a
 * note.
 */
async function repairCrossings(ctx: Ctx, rerouted: string[], start: Checkpoint, redraw: () => Promise<string[]>): Promise<string[]> {
  if (!newCrossings(ctx).length) return rerouted;
  let trials = 0;
  let retries = 0;
  let base: LayoutMetrics | undefined;
  let hard: Map<string, number> | undefined;
  const measure = (): LayoutMetrics => {
    writePlanes(ctx.doc.moddle, ctx.doc.definitions, ctx.planes);
    return layoutProblems(ctx.doc.definitions);
  };
  // what a trial must never add: a hard problem (counted per problem), or a crossing between two connections drawn
  // before this run (counted together: a reroute must not trade a crossing with a new connection for one among the
  // hand-drawn lines; a chain drawn again may cross another pair of them, not more)
  const DRAWN = 'crossings among drawn lines';
  const hardCounts = (m: LayoutMetrics): Map<string, number> => {
    const out = new Map<string, number>();
    for (const p of m.problems) {
      const key = isHardProblem(p) ? problemKey(p) : p.kind === 'crossings' && p.ids.every((id) => !ctx.newEdges.has(id)) ? DRAWN : undefined;
      if (key) out.set(key, (out.get(key) ?? 0) + 1);
    }
    return out;
  };
  const ensureBase = (): void => {
    if (base) return;
    base = measure();
    hard = hardCounts(base);
  };
  /** the guard: measures the drawing; true (and the new baseline) when it lowered the score and added nothing guarded */
  const judge = (what: string): boolean => {
    const m = measure();
    const now = hardCounts(m);
    const added = [...now].filter(([k, c]) => c > (hard!.get(k) ?? 0)).map(([k]) => k);
    const ok = !added.length && m.score < base!.score;
    if (LayoutDebug.on()) LayoutDebug.log(`[repair] ${what}: score ${base!.score} -> ${m.score}${added.length ? `, added ${added.join(' ')}` : ''}: ${ok ? 'kept' : 'undone'}`);
    if (ok) {
      base = m;
      hard = now;
    }
    return ok;
  };
  const reroutes = (list: string[]): void => {
    for (const [n, e, plane] of newCrossings(ctx)) {
      if (!polylinesCross(n.points, e.points)) continue;
      for (const target of [n, e]) {
        if (trials >= REPAIR_TRIALS) return;
        const pts = routeEdge(plane, target, { lines: routingLines(plane, target.id) });
        if (!pts || pts.length < 2 || samePoints(pts, target.points)) continue;
        // not measured: a route that still crosses the line it is tried for, or (an existing connection) that crosses
        // another drawn line it did not cross before (the guard would undo it)
        const other = target === n ? e : n;
        if (polylinesCross(pts, other.points) || (target === e && crossesNewDrawnLine(plane, target, pts))) {
          if (LayoutDebug.on()) LayoutDebug.log(`[repair] ${target.id} routed again (it crossed: ${n.id} x ${e.id}): still crossing, not measured`);
          continue;
        }
        trials++;
        ensureBase();
        const old = { points: target.points, label: target.label ? copyBox(target.label) : undefined };
        target.points = pts;
        if (target.label || raw<string>(target.el, 'name')) placeEdgeLabel(plane, target);
        if (!judge(`${target.id} routed again (it crossed: ${n.id} x ${e.id})`)) {
          target.points = old.points;
          if (old.label) target.label = old.label;
          else delete target.label;
          continue;
        }
        if (target === e) {
          if (!list.includes(e.id)) list.push(e.id);
          ctx.notes.push(`${e.id} routed again: it crossed the new ${n.id}`);
        }
        break;
      }
    }
  };
  /** an existing connection's new route crosses a connection drawn before this run that its old route did not cross */
  const crossesNewDrawnLine = (plane: Plane, target: DEdge, pts: readonly Point[]): boolean =>
    [...plane.edges.values()].some((o) => o !== target && !ctx.newEdges.has(o.id) && o.points.length >= 2 && polylinesCross(pts, o.points) && !polylinesCross(target.points, o.points));
  reroutes(rerouted);
  // the next row candidate of a chain that still crosses
  const tried = new Map<string, number>();
  while (trials < REPAIR_TRIALS && retries < CHAIN_RETRIES && !ctx.fromEngine.size && ctx.planes.length === start.planes.length) {
    let next: { head: string; rank: number } | undefined;
    for (const [n] of newCrossings(ctx)) {
      const head = chainHead(ctx, [n.targetId, n.sourceId]);
      if (!head) continue;
      const rank = Math.max(ctx.place.skip?.get(head) ?? 0, tried.get(head) ?? 0) + 1;
      if (rank < (ctx.place.heads?.get(head) ?? 0)) {
        next = { head, rank };
        break;
      }
    }
    if (!next) break;
    trials++;
    retries++;
    tried.set(next.head, next.rank);
    ensureBase();
    const kept = checkpoint(ctx);
    const keptRerouted = [...rerouted];
    const members = membersOf(ctx);
    const di = takeDi(ctx);
    const skip = new Map(ctx.place.skip ?? []);
    skip.set(next.head, next.rank);
    restore(ctx, start);
    ctx.place.skip = skip;
    let again: string[] | undefined;
    try {
      again = await redraw();
    } catch {
      again = undefined;
    }
    if (!again || membersOf(ctx) !== members) {
      restore(ctx, kept);
      rerouted = keptRerouted;
      continue;
    }
    giveDi(ctx, di);
    if (!judge(`${next.head} at its row candidate ${next.rank + 1}`)) {
      restore(ctx, kept);
      rerouted = keptRerouted;
      continue;
    }
    rerouted = again;
    ctx.notes.push(`${next.head} placed at another row: at the first one its path crossed a line`);
    reroutes(rerouted);
  }
  return rerouted;
}

function movedShapes(ctx: Ctx): string[] {
  const out: string[] = [];
  for (const plane of ctx.planes) {
    for (const s of plane.shapes.values()) {
      if (!s.di || (ctx.place.placed.has(s.id) && !ctx.relocated.has(s.id))) continue;
      const old = ctx.snap.byDi.get(s.di);
      if (old?.bounds && !sameBox(old.bounds, s.bounds)) out.push(s.id);
    }
  }
  for (const id of ctx.relocated) if (!out.includes(id)) out.push(id);
  return out;
}

/**
 * Vertical pools and lanes (isHorizontal=false) are not supported: the
 * placement, the space tool and the router all work on horizontal bands. A
 * run that would place, move or route anything on a plane with one fails
 * (auto mode then redraws in full, a requested incremental layout is refused);
 * pruning and label refits are fine.
 */
function assertHorizontal(ctx: Ctx, rerouted: readonly string[]): void {
  const changed = new Set([...ctx.place.placed, ...ctx.place.moved, ...rerouted, ...ctx.newEdges]);
  for (const plane of ctx.planes) {
    const vertical = verticalBand(plane);
    if (!vertical) continue;
    const touched = [...changed].filter((id) => plane.shapes.has(id) || plane.edges.has(id));
    if (touched.length) throw new Error(`${vertical.kind === 'lane' ? 'lane' : 'pool'} ${vertical.id} is drawn vertically (isHorizontal=false); the incremental layout only edits horizontal pools and lanes (it would have changed ${touched.slice(0, 3).join(', ')})`);
  }
}

/** A pool or lane of the plane drawn vertically (isHorizontal=false): the incremental layout routes nothing there (assertHorizontal). */
function verticalBand(plane: Plane): DShape | undefined {
  return [...plane.shapes.values()].find((s) => (s.kind === 'participant' || s.kind === 'lane') && s.di && raw<boolean>(s.di, 'isHorizontal') === false);
}

/** Number of BPMNShapes / BPMNEdges per plane and element (`plane id|element id`). */
function diCounts(defs: El): Map<string, number> {
  const out = new Map<string, number>();
  for (const diagram of rawList(defs, 'diagrams')) {
    const planeDi = raw<El>(diagram, 'plane');
    for (const pe of rawList(planeDi, 'planeElement')) {
      const id = idOf(raw(pe, 'bpmnElement'));
      if (!id) continue;
      const key = `${idOf(planeDi) ?? '?'}|${id}`;
      out.set(key, (out.get(key) ?? 0) + 1);
    }
  }
  return out;
}

/** Invariant: the run never gives an element a second DI element on one plane (duplicates the file already had are left alone). */
function assertNoNewDuplicates(before: Map<string, number>, defs: El): void {
  for (const [key, n] of diCounts(defs)) {
    if (n > Math.max(1, before.get(key) ?? 0)) throw new Error(`internal: the incremental layout drew ${key.split('|')[1]} twice on ${key.split('|')[0]}`);
  }
}

/** Incremental layout of a document after its ops ran (see module contract). */
export async function layoutIncremental(doc: Doc, snap: Snapshot, opts: IncrementalOptions = {}): Promise<IncrementalReport> {
  const defs = doc.definitions;
  const sem = semantics(defs);
  const prunedNow = pruneDi(defs, sem);
  // a further view is not drawn: the edge of a flow whose ends changed would show the old ends there
  const stale = pruneReEnded(defs, snap, { further: true });
  const counts = diCounts(defs);
  // a further diagram showing an element another diagram already shows is a second view of it: left as it is
  const planes = readPlanes(defs, sem).filter((p, i, all) => all.findIndex((q) => q.rootId === p.rootId) === i);
  const spacing = new Map<Plane, Spacing>(planes.map((p) => [p, spacingOf(p)]));
  const oldSource = new Map<string, string>();
  const oldTarget = new Map<string, string>();
  for (const [oldFlowId, ends] of snap.flowEnds) {
    const id = currentId(snap, oldFlowId);
    const el = sem.byId.get(id);
    if (!el) continue;
    const now = edgeEnds(el);
    // the old ends by their ids now (a renamed end is the same end)
    const source = currentId(snap, ends.sourceId);
    const target = currentId(snap, ends.targetId);
    if (source && now.sourceId !== source) oldSource.set(id, source);
    if (target && now.targetId !== target) oldTarget.set(id, target);
  }
  const notes: string[] = [];
  if (stale.length) notes.push(`edge(s) of ${[...new Set(stale)].join(', ')} removed from a further diagram of the same root: their ends changed, and further diagrams are not laid out`);
  const ctx: Ctx = {
    doc,
    sem,
    snap,
    planes,
    reroute: new Set(),
    newEdges: new Set(),
    fromEngine: new Set(),
    active: new Set(),
    relocated: new Set(),
    grown: new Set(),
    baseline: new Map(planes.flatMap((p) => [...p.shapes.values()].map((x) => [x.id, copyBox(x.bounds)] as [string, Box]))),
    created: opts.created ?? [],
    routedNow: new Map(),
    edgesBefore: new Map(),
    notes,
    place: {
      planes,
      sem,
      spacing,
      placed: new Set(),
      moved: new Set(),
      oldSource,
      oldTarget,
      reuse: new Map(),
      blockSize: new Map(),
      collapsed: new Set(opts.collapse ?? []),
      planeFor: (id) => ensurePlane(ctx, id),
      notes,
    },
  };
  let engine: Promise<{ planes: Plane[]; sem: Semantics }> | undefined;
  const blocks = (): Promise<{ planes: Plane[]; sem: Semantics }> => (engine ??= enginePlanes(doc, opts));

  const before = ctx.edgesBefore;
  // connections the file has that do not reach an end of theirs (detachedEnds; not one whose ends the ops changed) are broken whatever they were before: routed again, a note says why
  const detached = new Map<string, string[]>();
  for (const plane of planes) {
    const vertical = !!verticalBand(plane);
    for (const e of plane.edges.values()) {
      before.set(e, edgeBefore(plane, e));
      const ends = vertical ? [] : detachedEnds(plane, e);
      if (ends.length && !(e.di && changedEnds(snap, e.di).length)) detached.set(e.id, ends);
    }
  }

  const wrapped = followRoot(ctx);
  const strips = removedAndRelocated(ctx, new Set(opts.relocated ?? []));
  const ignore = new Set<string>([...ctx.reroute, ...oldSource.keys(), ...oldTarget.keys()]);
  closeStrips(ctx, strips, ignore);
  applyExpansion(ctx, opts);
  await placeContainers(ctx, wrapped, blocks);
  laneChanges(ctx);
  pullJoins(ctx);
  const start = checkpoint(ctx);
  const draw = async (): Promise<string[]> => {
    await placeNodes(ctx, blocks);
    growForNames(ctx);
    separateAll(ctx);
    growGroups(ctx);
    collectEdges(ctx, before);
    const r = routeAll(ctx);
    // existing connections routed when an end was placed (routeNow) and kept since: routed again all the same
    for (const id of ctx.routedNow.keys()) if (!ctx.newEdges.has(id) && !r.includes(id) && ctx.planes.some((p) => p.edges.has(id))) r.push(id);
    labels(ctx, new Set([...r, ...ctx.newEdges]));
    assertHorizontal(ctx, r);
    return r;
  };
  const rerouted = await repairCrossings(ctx, await draw(), start, draw);
  for (const id of new Set(rerouted)) {
    const ends = detached.get(id);
    if (ends) notes.push(`${id} routed again: it did not reach ${ends.join(' and ')}`);
  }
  writePlanes(doc.moddle, defs, ctx.planes);
  doc.invalidate();
  assertNoNewDuplicates(counts, defs);

  const live = new Set<El>();
  for (const p of ctx.planes) for (const x of [...p.shapes.values(), ...p.edges.values()]) if (x.di) live.add(x.di);
  const pruned = new Set(prunedNow);
  for (const [di, entry] of snap.byDi) if (!live.has(di) && !sem.byId.has(entry.id)) pruned.add(entry.id);
  // connections the space tool stretched or shortened (audit #61): their waypoints changed, they were not routed again
  const routed = new Set([...rerouted, ...ctx.newEdges]);
  const reshaped: string[] = [];
  for (const [e, b] of before) if (!routed.has(e.id) && !pruned.has(e.id) && !samePoints(b.points, e.points)) reshaped.push(e.id);
  return {
    mode: 'incremental',
    placed: [...ctx.place.placed, ...ctx.newEdges].filter((id, i, all) => all.indexOf(id) === i && !ctx.relocated.has(id)),
    moved: movedShapes(ctx),
    rerouted,
    reshaped: reshaped.filter((id, i) => reshaped.indexOf(id) === i),
    pruned: [...pruned],
    notes,
  };
}
