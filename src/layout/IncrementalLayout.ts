/**
 * Incremental layout: keep the drawing, place what is new, make room like
 * the modeler's space tool, reroute only the connections that need it.
 *
 * CONTRACT
 *  Snapshot.take(defs) (Snapshot.ts) records, BEFORE the ops run, what every DI element
 *  shows (by DI object, so renamed ids and retyped elements are still
 *  recognised) plus the semantic facts the diff needs (lanes, scopes, names,
 *  flow ends).
 *
 *  IncrementalLayout.run(doc, snapshot, opts) runs AFTER the ops and rewrites the
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
 *   6. new flow nodes and artifacts are placed (diagram/NodePlacer.ts) in op order
 *      (opts.created) where their neighbours allow; while more follow, the
 *      sequence flows of each placed node are routed right away, and so are
 *      the connections the placement broke (sequence flows, associations and
 *      data associations; message flows wait for step 8), and the spacing is
 *      measured again
 *      (routeNow: what the next single command would see); a new expanded
 *      sub-process with content and a new pool with content are laid out by
 *      the clean engine as one block and placed like a node of that size;
 *      an activity (task, call activity, collapsed sub-process) whose new or
 *      changed name does not fit its box (diagram/utils/text.ts activitySize: bpmn-js line
 *      breaking, room kept for a marker or boundary events on the bottom
 *      border) grows: wider in steps of 20 up to 200 px, then higher around
 *      its centre row, never smaller. Its left border stays, its boundary
 *      events are re-seated, and when the wider box comes closer than the
 *      drawing's gap (at most 40 px) to what follows on its row (shapes and
 *      their labels), the space tool makes room by the added width (anchored
 *      at the activity); an external label the grown box covers is placed
 *      again (step 9); a renamed expanded sub-process whose title (diagram/utils/text.ts
 *      titleBox) now takes more lines than the old one did and comes closer
 *      than 4 px to the shapes and labels drawn in it under the title
 *      (inside the frame, below its top border: not a message flow's label
 *      between the pools) makes room: its content moves down by the
 *      difference, at most by the depth the title gained, and it grows
 *      (space tool at its top in frame mode, a note says so)
 *   7. local overlap removal around everything placed or moved (diagram/Separation.ts)
 *   8. connections: new ones are routed, kept ones are rerouted only when an
 *      end changed, was placed or moved away from it, or when they now cut a
 *      shape (diagram/EdgeRouter.ts); connections entirely inside a shifted region were
 *      translated by the space tool. A connection routed during step 6 is
 *      routed again only when it broke since (like a flow an earlier single
 *      command drew); an existing one counts as rerouted
 *   9. labels of new / renamed elements and rerouted named flows are placed;
 *      a kept label a new line runs over or a grown activity covers steps
 *      aside (and the label of a boundary event the placement moved to its
 *      host's top border), and so does a label now on the title of an
 *      expanded sub-process that it was clear of before the ops (diagram/LabelPlacer.ts
 *      clearTitles: room made in a sub-process moves its centred title by
 *      half the added width, a label beyond the line by all of it; a renamed
 *      title can be wider), unless its new spot is on a title too or outside
 *      its sub-process / pool
 *  10. local repair (CrossingRepair.ts, issue #18 (3)): for every crossing
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
 *  ends changed (Snapshot pruneReEnded: it would show the old ends; a note names
 *  them). A kept connection that does not reach an end of its own
 *  (diagram/EdgeRouter.ts detachedEnds: left at the end's old place by another tool or
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
 *  DiagramGeometry.of(defs).drawnBy(laidOut) (DiagramGeometry.ts) says whether a drawing (everything it
 *  shows) equals what the engine drew for the same
 *  model in `laidOut`: the same shapes and connections, every bound, label
 *  and waypoint within 2 px.
 */
import { CrossingRepair } from './CrossingRepair.js';
import { DuplicateDiGuard } from './DuplicateDiGuard.js';
import { EngineDrawing, type Block } from './EngineDrawing.js';
import type { Snapshot } from './Snapshot.js';
import { LayoutDebug } from '../shared/LayoutDebug.js';
import type { Doc } from '../model/document.js';
import { SIZES } from '../diagram/utils/sizes.js';
import { is, layoutRoot, type El } from '../model/utils/moddle.js';
import { bottom, copyBox, copyPoints, cx, cy, inside, overlaps, right, sameBox, samePoints, segmentHits, type Box, type Point } from '../diagram/utils/geom.js';
import { hasExternalLabel } from '../diagram/utils/labels.js';
import { NodePlacer, type PlacementHooks, type PlacerState } from '../diagram/NodePlacer.js';
import { verticalBand, predecessors, successors, spacingOf, boundariesOf, contentOf, edgeEnds, edgeKind, frameInterior, frameOf, idOf, inFrame, isLeaf, isSubProcess, raw, rawList, titleOf } from '../diagram/utils/plane.js';
import { homePlane, readPlanes, semantics } from '../diagram/plane.js';
import type { DEdge, DShape, Plane, Semantics } from '../diagram/types.js';
import type { EdgeBefore } from '../diagram/EdgeRouter.js';
import { attachedSide } from '../diagram/utils/sides.js';
import { activitySize, BOTTOM_ROOM, titleBox } from '../diagram/utils/text.js';
import { pruneDi, writePlanes } from '../diagram/write.js';
import { PlaneCheckpoint } from '../diagram/PlaneCheckpoint.js';
import { Drawing } from '../diagram/Drawing.js';
import type { SpaceResult } from '../diagram/SpaceTool.js';

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

export interface Checkpoint {
  planes: Plane[];
  members: Map<Plane, { shapes: DShape[]; edges: DEdge[] }>;
  shapes: Map<DShape, { bounds: Box; label?: Box }>;
  edges: Map<DEdge, { points: Point[]; label?: Box; sourceId?: string; targetId?: string }>;
  placer: PlacerState;
  sets: Pick<IncrementalLayout, 'reroute' | 'newEdges' | 'fromEngine' | 'active' | 'relocated' | 'grown' | 'routedNow'>;
  notes: string[];
}

export class IncrementalLayout implements PlacementHooks {
  readonly sem: Semantics;
  readonly planes: Plane[];
  readonly place: NodePlacer;
  readonly notes: string[] = [];
  /** edges (by id) that must be (re)routed */
  reroute = new Set<string>();
  /** connections created in this run */
  newEdges = new Set<string>();
  /** shapes / edges copied from the engine (already laid out) */
  fromEngine = new Set<string>();
  /** nodes that moved for a semantic reason (lane change, relocation, resize) */
  active = new Set<string>();
  /** nodes re-inserted elsewhere (placed again, reported as moved) */
  relocated = new Set<string>();
  /** activities grown to fit their name */
  grown = new Set<string>();
  /** flows routed when their second end was placed (routeNow): their state then, to tell whether they broke since */
  routedNow = new Map<string, EdgeBefore>();
  /** shape bounds before anything moved */
  private readonly baseline: Map<string, Box>;
  /** ids the ops created, in op order (IncrementalOptions.created) */
  private readonly created: readonly string[];
  /** every connection's state before anything moved (brokenEdge) */
  private readonly edgesBefore = new Map<DEdge, EdgeBefore>();
  /** sequence flows whose source / target changed: their ids before the ops */
  private readonly oldSource = new Map<string, string>();
  private readonly oldTarget = new Map<string, string>();
  private engineRun?: Promise<EngineDrawing>;
  afterPlace?: (plane: Plane, s: DShape) => void;
  afterNode?: (plane: Plane, id: string) => void;
  
  /** Incremental layout of a document after its ops ran (see module contract). */
  static async run(doc: Doc, snap: Snapshot, opts: IncrementalOptions = {}): Promise<IncrementalReport> {
    const sem = semantics(doc.definitions);
    const prunedNow = pruneDi(doc.definitions, sem);
    // a further view is not drawn: the edge of a flow whose ends changed would show the old ends there
    const stale = snap.pruneReEnded(doc.definitions, { further: true });
    const duplicates = new DuplicateDiGuard(doc.definitions);
    return new IncrementalLayout(doc, snap, opts, sem, stale).layout(prunedNow, duplicates);
  }
  
  private constructor(
    readonly doc: Doc,
    private readonly snap: Snapshot,
    private readonly opts: IncrementalOptions,
    sem: Semantics,
    stale: readonly string[],
  ) {
    this.sem = sem;
    // a further diagram showing an element another diagram already shows is a second view of it: left as it is
    this.planes = readPlanes(doc.definitions, sem).filter((p, i, all) => all.findIndex((q) => q.rootId === p.rootId) === i);
    for (const [oldFlowId, ends] of snap.flowEnds) {
      const id = snap.currentId(oldFlowId);
      const el = sem.byId.get(id);
      if (!el) continue;
      const now = edgeEnds(el);
      // the old ends by their ids now (a renamed end is the same end)
      const source = snap.currentId(ends.sourceId);
      const target = snap.currentId(ends.targetId);
      if (source && now.sourceId !== source) this.oldSource.set(id, source);
      if (target && now.targetId !== target) this.oldTarget.set(id, target);
    }
    if (stale.length) this.notes.push(`edge(s) of ${[...new Set(stale)].join(', ')} removed from a further diagram of the same root: their ends changed, and further diagrams are not laid out`);
    this.baseline = new Map(this.planes.flatMap((p) => [...p.shapes.values()].map((x) => [x.id, copyBox(x.bounds)] as [string, Box])));
    this.created = opts.created ?? [];
    this.place = new NodePlacer(this.planes, sem, this.oldSource, this.oldTarget, new Set(opts.collapse ?? []), this.notes, this);
  }
  
  private async layout(prunedNow: readonly string[], duplicates: DuplicateDiGuard): Promise<IncrementalReport> {
    const defs = this.doc.definitions;
    const before = this.edgesBefore;
    // connections the file has that do not reach an end of theirs (detachedEnds; not one whose ends the ops changed) are broken whatever they were before: routed again, a note says why
    const detached = new Map<string, string[]>();
    for (const plane of this.planes) {
      const vertical = !!verticalBand(plane);
      for (const e of plane.edges.values()) {
        before.set(e, this.drawing(plane).edgeBefore(e));
        const ends = vertical ? [] : this.drawing(plane).detachedEnds(e);
        if (ends.length && !(e.di && this.snap.changedEnds(e.di).length)) detached.set(e.id, ends);
      }
    }
  
    const wrapped = this.followRoot();
    const strips = this.removedAndRelocated(new Set(this.opts.relocated ?? []));
    const ignore = new Set<string>([...this.reroute, ...this.oldSource.keys(), ...this.oldTarget.keys()]);
    this.closeStrips(strips, ignore);
    this.applyExpansion(this.opts);
    await this.placeContainers(wrapped);
    this.laneChanges();
    this.pullJoins();
    const start = this.checkpoint();
    const rerouted = await new CrossingRepair(this).repair(await this.draw(), start, () => this.draw());
    for (const id of new Set(rerouted)) {
      const ends = detached.get(id);
      if (ends) this.notes.push(`${id} routed again: it did not reach ${ends.join(' and ')}`);
    }
    writePlanes(this.doc.moddle, defs, this.planes);
    this.doc.invalidate();
    duplicates.assertNone(defs);
  
    const live = new Set<El>();
    for (const p of this.planes) for (const x of [...p.shapes.values(), ...p.edges.values()]) if (x.di) live.add(x.di);
    const pruned = new Set(prunedNow);
    for (const [di, entry] of this.snap.byDi) if (!live.has(di) && !this.sem.byId.has(entry.id)) pruned.add(entry.id);
    // connections the space tool stretched or shortened (audit #61): their waypoints changed, they were not routed again
    const routed = new Set([...rerouted, ...this.newEdges]);
    const reshaped: string[] = [];
    for (const [e, b] of before) if (!routed.has(e.id) && !pruned.has(e.id) && !samePoints(b.points, e.points)) reshaped.push(e.id);
    return {
      mode: 'incremental',
      placed: [...this.place.placed, ...this.newEdges].filter((id, i, all) => all.indexOf(id) === i && !this.relocated.has(id)),
      moved: this.movedShapes(),
      rerouted,
      reshaped: reshaped.filter((id, i) => reshaped.indexOf(id) === i),
      pruned: [...pruned],
      notes: this.notes,
    };
  }
  
  /** Steps 6 to 9 (see module contract); the local repair runs them again from a checkpoint. */
  private async draw(): Promise<string[]> {
    await this.placeNodes();
    this.growForNames();
    this.separateAll();
    this.growGroups();
    this.collectEdges(this.edgesBefore);
    const r = this.routeAll();
    // existing connections routed when an end was placed (routeNow) and kept since: routed again all the same
    for (const id of this.routedNow.keys()) if (!this.newEdges.has(id) && !r.includes(id) && this.planes.some((p) => p.edges.has(id))) r.push(id);
    this.labels(new Set([...r, ...this.newEdges]));
    this.assertHorizontal(r);
    return r;
  }

  /** Flow nodes, artifacts and connections of the model, parents before children. */
  private modelOrder(defs: El): El[] {
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

  private shapeIndex(planes: readonly Plane[]): Map<string, { plane: Plane; shape: DShape }> {
    const out = new Map<string, { plane: Plane; shape: DShape }>();
    for (const plane of planes) for (const s of plane.shapes.values()) out.set(s.id, { plane, shape: s });
    return out;
  }

  private edgeIndex(planes: readonly Plane[]): Map<string, { plane: Plane; edge: DEdge }> {
    const out = new Map<string, { plane: Plane; edge: DEdge }>();
    for (const plane of planes) for (const e of plane.edges.values()) out.set(e.id, { plane, edge: e });
    return out;
  }

  private isFlowNode(el: El): boolean {
    return is(el, 'bpmn:FlowNode');
  }

  private isArtifactShape(el: El): boolean {
    return is(el, 'bpmn:DataObjectReference') || is(el, 'bpmn:DataStoreReference') || is(el, 'bpmn:TextAnnotation');
  }

  private isConnection(el: El): boolean {
    return is(el, 'bpmn:SequenceFlow') || is(el, 'bpmn:MessageFlow') || is(el, 'bpmn:Association') || is(el, 'bpmn:DataAssociation');
  }

  /** Copies engine geometry onto `plane` (shifted by dx/dy), rebinding to the document's elements. */
  private adoptBlock(plane: Plane, block: Block, dx: number, dy: number): void {
    const rebindShape = (s: DShape, target: Plane, ox: number, oy: number): void => {
      const el = this.sem.byId.get(s.id);
      if (!el || target.shapes.has(s.id)) return;
      const copy = this.place.newShape(target, s.id, { x: s.bounds.x + ox, y: s.bounds.y + oy, width: s.bounds.width, height: s.bounds.height });
      if (s.label) copy.label = { ...s.label, x: s.label.x + ox, y: s.label.y + oy };
      if (s.kind === 'subProcess') {
        copy.expanded = s.expanded === true;
        copy.container = s.expanded === true;
      }
      target.shapes.set(s.id, copy);
      this.place.placed.add(s.id);
      this.fromEngine.add(s.id);
    };
    const rebindEdge = (e: DEdge, target: Plane, ox: number, oy: number): void => {
      const el = this.sem.byId.get(e.id);
      if (!el || target.edges.has(e.id)) return;
      const copy: DEdge = { id: e.id, el, kind: edgeKind(el), ...edgeEnds(el), points: e.points.map((p) => ({ x: p.x + ox, y: p.y + oy })) };
      if (e.label) copy.label = { ...e.label, x: e.label.x + ox, y: e.label.y + oy };
      target.edges.set(e.id, copy);
      this.fromEngine.add(e.id);
      this.newEdges.add(e.id);
    };
    // containers first so the content's membership (parentId) resolves
    for (const s of [...block.shapes].sort((a, b) => Number(b.container) - Number(a.container))) rebindShape(s, plane, dx, dy);
    for (const s of plane.shapes.values()) {
      if (!this.fromEngine.has(s.id)) continue;
      const scope = this.sem.scopeOf.get(s.id);
      const sid = idOf(scope);
      if (scope && sid && isSubProcess(scope) && plane.shapes.get(sid)?.expanded) s.parentId = sid;
    }
    for (const e of block.edges) rebindEdge(e, plane, dx, dy);
    for (const p of block.planes) {
      const root = this.sem.byId.get(p.rootId);
      if (!root || this.planes.some((q) => q.rootId === p.rootId)) continue;
      const target: Plane = { id: `BPMNPlane_${p.rootId}`, rootId: p.rootId, root, shapes: new Map(), edges: new Map(), dropped: [] };
      this.planes.push(target);
      for (const s of p.shapes.values()) rebindShape(s, target, 0, 0);
      for (const e of p.edges.values()) rebindEdge(e, target, 0, 0);
    }
  }

  /** What the clean engine draws for the document, laid out once per run when a block of it is needed. */
  private engineDrawing(): Promise<EngineDrawing> {
    return (this.engineRun ??= EngineDrawing.of(this.doc, this.opts));
  }

  /** The drawing of a plane in this run: what its frame edits move goes into the run's moved shapes. */
  drawing(plane: Plane): Drawing {
    return new Drawing(plane, this.place.moved);
  }

  /** The id an element had before the ops (its DI is the same object even when `set id=` renamed it). */
  private oldId(x: DShape | DEdge): string {
    return (x.di && this.snap.byDi.get(x.di)?.id) || x.id;
  }

  /** The id now of an element known by its id before the ops. */
  private cur(id: string | undefined): string | undefined {
    return this.snap.currentId(id);
  }

  private planeOfDi(planes: readonly Plane[], planeDi: El | undefined): Plane | undefined {
    return planeDi ? planes.find((p) => p.di === planeDi) : undefined;
  }

  /** A plane for a collapsed sub-process that has none yet. */
  planeFor(id: string): Plane | undefined {
    const home = homePlane(this.planes, this.sem, id);
    if (home) return home;
    const el = this.sem.byId.get(id);
    if (!el) return undefined;
    const anchor = is(el, 'bpmn:DataAssociation') ? idOf(el.$parent) : id;
    const scope = anchor ? this.sem.scopeOf.get(anchor) : undefined;
    const sid = idOf(scope);
    if (!scope || !sid || !isSubProcess(scope)) return undefined;
    // only for a sub-process drawn collapsed (a pending one that will be expanded gets its content later)
    const shape = this.planes.map((p) => p.shapes.get(sid)).find((x) => !!x);
    if (shape?.expanded) return undefined;
    if (!shape && !(this.place.collapsed.has(sid) && this.planeFor(sid))) return undefined;
    const plane: Plane = { id: `BPMNPlane_${sid}`, rootId: sid, root: scope, shapes: new Map(), edges: new Map(), dropped: [] };
    this.planes.push(plane);
    return plane;
  }

  /** Re-points the root plane at a new collaboration; returns the participant wrapping the old root process. */
  private followRoot(): string | undefined {
    const root = layoutRoot(this.doc.definitions);
    const rootId = idOf(root);
    if (!root || !rootId || rootId === this.snap.rootId || !is(root, 'bpmn:Collaboration')) return undefined;
    const old = this.planes.find((p) => p.rootId === this.snap.rootId);
    if (!old || this.planes.some((p) => p.rootId === rootId)) return undefined;
    old.root = root;
    old.rootId = rootId;
    const wrapper = rawList(root, 'participants').find((p) => idOf(raw(p, 'processRef')) === this.snap.rootId);
    // the content now belongs to a pool: refresh membership
    const poolId = idOf(wrapper);
    if (poolId) for (const s of old.shapes.values()) if (!s.poolId && s.kind !== 'participant') s.poolId = poolId;
    return poolId;
  }

  private removedAndRelocated(relocated: Set<string>): Array<{ plane: Plane; box: Box; poolId?: string; parentId?: string }> {
    const strips: Array<{ plane: Plane; box: Box; poolId?: string; parentId?: string }> = [];
    const live = new Set<El>();
    for (const p of this.planes) {
      for (const s of p.shapes.values()) if (s.di) live.add(s.di);
      for (const e of p.edges.values()) if (e.di) live.add(e.di);
    }
    for (const [di, entry] of this.snap.byDi) {
      if (live.has(di) || !entry.bounds) continue;
      const plane = this.planeOfDi(this.planes, entry.planeDi);
      if (!plane) continue;
      if (entry.kind === 'lane') {
        this.drawing(plane).removedLane(entry.bounds, entry.poolId, entry.laneId);
        continue;
      }
      if (entry.kind === 'participant') {
        this.drawing(plane).removedPool(entry.bounds);
        continue;
      }
      const flowNode = ['task', 'subProcess', 'event', 'gateway'].includes(entry.kind);
      const poolId = this.cur(entry.poolId);
      const parentId = this.cur(entry.parentId);
      const frameGone = (poolId && !plane.shapes.has(poolId)) || (parentId && !plane.shapes.has(parentId));
      if (flowNode && !frameGone) strips.push({ plane, box: entry.bounds, ...(poolId ? { poolId } : {}), ...(parentId ? { parentId } : {}) });
    }
    // nodes that left their place in the flow, their scope or their plane; boundary events moved to another host
    for (const plane of this.planes) {
      for (const s of [...plane.shapes.values()]) {
        if (!this.isFlowNode(s.el)) continue;
        if (s.kind === 'boundary') {
          const hostBefore = this.cur(this.snap.hostOf.get(this.oldId(s)));
          if (!s.di || !this.snap.byDi.has(s.di) || hostBefore === undefined || hostBefore === s.hostId || !plane.shapes.has(s.id)) continue;
          // re-attached (`move --on`): placed again on the new host, its DI reused
          plane.shapes.delete(s.id);
          this.place.reuse.set(s.id, { shape: s, boundaries: [], from: plane });
          this.relocated.add(s.id);
          for (const e of plane.edges.values()) if (e.sourceId === s.id || e.targetId === s.id) this.reroute.add(e.id);
          continue;
        }
        // compared by the ids now: renaming a process or sub-process (`set id=`) relocates nothing
        const scopeNow = idOf(this.sem.scopeOf.get(s.id));
        const scopeBefore = this.cur(this.snap.scopeOf.get(this.oldId(s)));
        const home = homePlane(this.planes, this.sem, s.id);
        if (!relocated.has(s.id) && scopeNow === scopeBefore && (!home || home === plane)) continue;
        const boundaries = [...plane.shapes.values()].filter((b) => b.hostId === s.id);
        const content = s.kind === 'subProcess' && s.expanded ? contentOf(plane, s.id) : undefined;
        plane.shapes.delete(s.id);
        for (const b of boundaries) plane.shapes.delete(b.id);
        for (const c of content?.shapes ?? []) plane.shapes.delete(c.id);
        this.place.reuse.set(s.id, { shape: s, boundaries, from: plane, ...(content ? { content } : {}) });
        this.relocated.add(s.id);
        // the strip is where the node was: in the frame it had before the ops (it may have moved into another one)
        const was = s.di ? this.snap.byDi.get(s.di) : undefined;
        const poolId = was ? this.cur(was.poolId) : s.poolId;
        const parentId = was ? this.cur(was.parentId) : s.parentId;
        strips.push({ plane, box: copyBox(s.bounds), ...(poolId ? { poolId } : {}), ...(parentId ? { parentId } : {}) });
        const own = new Set([s.id, ...boundaries.map((b) => b.id)]);
        const inner = new Set(content?.edges.map((e) => e.id) ?? []);
        for (const e of plane.edges.values()) {
          if (inner.has(e.id)) continue;
          if ((e.sourceId && own.has(e.sourceId)) || (e.targetId && own.has(e.targetId))) this.reroute.add(e.id);
        }
      }
    }
    return strips;
  }

  private closeStrips(strips: Array<{ plane: Plane; box: Box; poolId?: string; parentId?: string }>, ignore: Set<string>): void {
    const sorted = [...strips].sort((a, b) => b.box.x - a.box.x);
    for (const st of sorted) {
      const sp = this.place.spacing.get(st.plane) ?? spacingOf(st.plane);
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
      const r = this.drawing(st.plane).closeStrip({ axis: 'x', from, to, gap: sp.gap, ignore, ...(band ? { within: { ...band } } : {}), ...(keep ? { keep } : {}) }) ?? (sub ? undefined : this.closeRow(st.plane, st.box, frame, from, to, sp.gap, ignore));
      if (LayoutDebug.on()) LayoutDebug.log(`[strip] x ${Math.round(from)}..${Math.round(to)}${band ? ` in ${frame!.id}` : ''}: ${r ? `closed, moved ${[...r.moved].join(',')}` : 'kept'}`);
      if (r) r.moved.forEach((x) => this.place.moved.add(x));
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
  private closeRow(plane: Plane, box: Box, frame: DShape | undefined, from: number, to: number, gap: number, ignore: ReadonlySet<string>): SpaceResult | undefined {
    const pad = 10;
    const fb = frame?.bounds;
    const row: Box = { x: fb ? fb.x : -1e7, y: box.y - pad, width: fb ? fb.width : 2e7, height: box.height + 2 * pad };
    const onRow = [...plane.shapes.values()].filter((s) => isLeaf(s) && s.bounds.y < row.y + row.height && s.bounds.y + s.bounds.height > row.y && (!fb || (s.bounds.x >= fb.x && s.bounds.x <= right(fb))));
    // the strip on this row ends where the next shape starts (the drawing's gap there may be smaller than the median)
    const end = Math.min(to, ...onRow.filter((s) => s.bounds.x >= right(box) - 1).map((s) => s.bounds.x));
    if (!onRow.some((s) => s.bounds.x >= end - 3)) return undefined;
    const saved = new PlaneCheckpoint(plane);
    const r = new Drawing(plane).closeStrip({ axis: 'x', from, to: end, gap, ignore, within: row });
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
  private shrinkRetyped(plane: Plane, s: DShape): void {
    const old = s.di ? this.snap.byDi.get(s.di) : undefined;
    if (s.kind === 'subProcess' || !old?.expanded || !s.di) return;
    const before = copyBox(s.bounds);
    s.bounds = { x: before.x, y: Math.round(cy(before) - SIZES.task.height / 2), ...SIZES.task };
    s.di.set('isExpanded', undefined);
    s.container = false;
    this.drawing(plane).reseatBoundaries(s, before);
    this.active.add(s.id);
    const sp = this.place.spacing.get(plane) ?? spacingOf(plane);
    const band = s.poolId ? plane.shapes.get(s.poolId)?.bounds : undefined;
    const own = new Set([...plane.edges.values()].filter((e) => e.sourceId === s.id || e.targetId === s.id).map((e) => e.id));
    const r = this.drawing(plane).closeStrip({ axis: 'x', from: right(s.bounds), to: right(before) + sp.gap, gap: sp.gap, ignore: own, ...(band ? { within: { ...band } } : {}) });
    r?.moved.forEach((x) => this.place.moved.add(x));
    own.forEach((id) => this.reroute.add(id));
  }

  /** Sub-processes whose requested expansion differs from their drawing are collapsed / expanded. */
  private applyExpansion(opts: IncrementalOptions): void {
    const want = new Map<string, boolean>();
    for (const id of opts.expand ?? []) want.set(id, true);
    for (const id of opts.collapse ?? []) want.set(id, false);
    for (const plane of [...this.planes]) {
      for (const s of [...plane.shapes.values()]) {
        if (s.kind !== 'subProcess') {
          this.shrinkRetyped(plane, s);
          continue;
        }
        const desired = want.get(s.id);
        if (desired === undefined || desired === (s.expanded === true)) continue;
        const sp = this.place.spacing.get(plane) ?? spacingOf(plane);
        if (!desired) {
          let child = this.planes.find((p) => p.rootId === s.id);
          if (!child) {
            child = { id: `BPMNPlane_${s.id}`, rootId: s.id, root: s.el, shapes: new Map(), edges: new Map(), dropped: [] };
            this.planes.push(child);
          }
          this.drawing(plane).collapse(s, child, sp.gap);
        } else {
          this.drawing(plane).expand(s, this.planes.find((p) => p.rootId === s.id), this.sem);
        }
        this.active.add(s.id);
        for (const e of plane.edges.values()) if (e.sourceId === s.id || e.targetId === s.id) this.reroute.add(e.id);
        this.notes.push(`${s.id} drawn ${desired ? 'expanded' : 'collapsed'}`);
      }
    }
  }

  private async placeContainers(wrapped: string | undefined): Promise<void> {
    const shapes = this.shapeIndex(this.planes);
    for (const el of this.modelOrder(this.doc.definitions)) {
      const id = idOf(el);
      if (!id || shapes.has(id)) continue;
      if (is(el, 'bpmn:Participant')) {
        const plane = homePlane(this.planes, this.sem, id);
        if (!plane) continue;
        const s = this.place.newShape(plane, id, { x: 0, y: 0, width: 0, height: 0 });
        const proc = raw<El>(el, 'processRef');
        // a new pool whose process has content: the engine lays that content out as one block
        const content = id !== wrapped && proc ? rawList(proc, 'flowElements').filter(this.isFlowNode) : [];
        const block = content.length ? (await this.engineDrawing()).block(id, true) : undefined;
        if (id === wrapped) this.drawing(plane).wrapPool(s);
        else this.drawing(plane).placePool(s, !proc, block ? { width: block.box.width, height: block.box.height } : undefined);
        plane.shapes.set(id, s);
        if (block) this.adoptBlock(plane, block, s.bounds.x - block.box.x, s.bounds.y - block.box.y);
        this.place.placed.add(id);
        shapes.set(id, { plane, shape: s });
      } else if (is(el, 'bpmn:Lane')) {
        const plane = homePlane(this.planes, this.sem, id);
        if (!plane) continue;
        const s = this.place.newShape(plane, id, { x: 0, y: 0, width: 0, height: 0 });
        if (!this.drawing(plane).placeLane(s)) {
          this.notes.push(`lane ${id} not drawn: its process has no pool in the diagram`);
          continue;
        }
        plane.shapes.set(id, s);
        this.place.placed.add(id);
        shapes.set(id, { plane, shape: s });
      }
    }
  }

  private laneChanges(): void {
    for (const plane of this.planes) {
      for (const s of [...plane.shapes.values()]) {
        if (!this.isFlowNode(s.el) || s.kind === 'boundary' || this.place.placed.has(s.id)) continue;
        const now = this.sem.laneOf.get(s.id);
        if (now === this.cur(this.snap.laneOf.get(this.oldId(s))) || !now) continue;
        if (this.place.changeLane(plane, s.id)) this.active.add(s.id);
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
  private pullJoins(): void {
    const before = new Set([...this.snap.flowEnds.keys()].map((id) => this.snap.currentId(id)));
    let next: Map<string, string[]> | undefined;
    const reaches = (from: string, to: string): boolean => {
      if (!next) {
        next = new Map();
        for (const el of this.sem.byId.values()) {
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
    for (const el of this.sem.byId.values()) {
      const fid = idOf(el);
      if (!fid || !is(el, 'bpmn:SequenceFlow') || (before.has(fid) && !this.place.oldTarget.has(fid))) continue;
      const { sourceId, targetId } = edgeEnds(el);
      const plane = this.planes.find((p) => !!targetId && p.shapes.has(targetId));
      const join = targetId ? plane?.shapes.get(targetId) : undefined;
      const source = sourceId ? plane?.shapes.get(sourceId) : undefined;
      if (!plane || !join || !source || !join.di || !this.snap.byDi.has(join.di) || this.relocated.has(join.id) || this.place.joins?.has(join.id)) continue;
      if (!is(join.el, 'bpmn:Gateway') || cx(join.bounds) >= source.bounds.x) continue;
      const ins = seqFlows(join.el, 'incoming');
      const outs = seqFlows(join.el, 'outgoing');
      const S = outs.length === 1 ? plane.shapes.get(idOf(raw(outs[0], 'targetRef')) ?? '') : undefined;
      if (ins.length < 2 || !S || reaches(join.id, source.id)) continue;
      const preds = ins.map((f) => plane.shapes.get(idOf(raw(f, 'sourceRef')) ?? ''));
      const sameFrame = (s: DShape | undefined): boolean => !!s && s.poolId === join.poolId && s.parentId === join.parentId;
      if (!preds.every(sameFrame) || !sameFrame(S) || S.bounds.x <= Math.max(...preds.map((p) => right(p!.bounds)))) continue;
      plane.shapes.delete(join.id);
      this.place.reuse.set(join.id, { shape: join, boundaries: [], from: plane });
      (this.place.joins ??= new Map()).set(join.id, S.id);
      this.relocated.add(join.id);
      for (const e of plane.edges.values()) if (e.sourceId === join.id || e.targetId === join.id) this.reroute.add(e.id);
      if (LayoutDebug.on()) LayoutDebug.log(`[join] ${join.id}: ${fid} from ${source.id} would enter it backwards: placed again before ${S.id}`);
    }
  }

  private async placeNodes(): Promise<void> {
    const drawn = (id: string): boolean => this.planes.some((p) => p.shapes.has(id));
    const order = this.modelOrder(this.doc.definitions);
    // new nodes in op order (the model lists an inserted node next to its anchor), the others in model order after them
    const rank = new Map(this.created.map((id, i) => [id, i]));
    const pendingNodes = order
      .filter((el) => this.isFlowNode(el) && idOf(el) && !drawn(idOf(el)!))
      .map((el) => idOf(el)!)
      .map((id, i) => ({ id, key: rank.get(id) ?? this.created.length + i }))
      .sort((a, b) => a.key - b.key)
      .map((x) => x.id);
    // new expanded sub-processes with content: one block from the engine
    const blockRoots = pendingNodes.filter((id) => {
      const el = this.sem.byId.get(id)!;
      return isSubProcess(el) && !this.place.collapsed.has(id) && rawList(el, 'flowElements').some(this.isFlowNode) && !this.place.reuse.has(id);
    });
    const inBlock = new Set<string>();
    const blocksByRoot = new Map<string, Block>();
    if (blockRoots.length) {
      const engine = await this.engineDrawing();
      for (const root of blockRoots) {
        if (inBlock.has(root)) continue;
        const block = engine.block(root, false);
        if (!block) continue;
        this.place.blockSize.set(root, { width: block.box.width, height: block.box.height });
        for (const s of block.shapes) inBlock.add(s.id);
        for (const p of block.planes) for (const s of p.shapes.values()) inBlock.add(s.id);
        blocksByRoot.set(root, block);
      }
    }
    // collapsed sub-processes whose content has no DI at all: their own diagram from the engine
    for (const id of pendingNodes) {
      const scope = this.sem.scopeOf.get(id);
      const sid = idOf(scope);
      if (!scope || !sid || !isSubProcess(scope) || inBlock.has(id) || this.planes.some((p) => p.rootId === sid)) continue;
      const shape = this.planes.map((p) => p.shapes.get(sid)).find((x) => !!x);
      if (shape ? shape.expanded : !this.place.collapsed.has(sid)) continue;
      if (rawList(scope, 'flowElements').some((fe) => this.isFlowNode(fe) && drawn(idOf(fe) ?? ''))) continue;
      const enginePlane = (await this.engineDrawing()).planes.find((p) => p.rootId === sid);
      if (!enginePlane) continue;
      this.adoptBlock(this.planes[0]!, { box: { x: 0, y: 0, width: 0, height: 0 }, shapes: [], edges: [], planes: [enginePlane] }, 0, 0);
      for (const s of enginePlane.shapes.values()) inBlock.add(s.id);
    }
    this.afterPlace = (plane: Plane, s: DShape): void => {
      const block = blocksByRoot.get(s.id);
      if (block) this.adoptBlock(plane, block, s.bounds.x - block.box.x, s.bounds.y - block.box.y);
    };
    this.afterNode = (plane: Plane, id: string): void => this.routeNow(plane, id);
    const skipped = this.place.placeFlowNodes(
      pendingNodes.filter((id) => !inBlock.has(id)),
    );
    delete this.afterPlace;
    delete this.afterNode;
    for (const id of skipped) this.notes.push(`${id} not drawn: it belongs to no diagram`);
    for (const el of order) {
      const id = idOf(el);
      if (!id || !this.isArtifactShape(el) || drawn(id) || inBlock.has(id)) continue;
      if (!this.place.placeArtifact(id)) this.notes.push(`${id} not drawn: it belongs to no diagram`);
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
  private routeNow(plane: Plane, id: string): void {
    const s = plane.shapes.get(id);
    const el = this.sem.byId.get(id);
    if (!s || !el) return;
    for (const f of [...rawList(el, 'incoming'), ...rawList(el, 'outgoing')]) {
      const fid = idOf(f);
      if (!fid || !is(f, 'bpmn:SequenceFlow')) continue;
      const ends = edgeEnds(f);
      const other = ends.sourceId === id ? ends.targetId : ends.sourceId;
      if (!other || !plane.shapes.has(other) || this.planes.some((p) => p !== plane && p.edges.has(fid))) continue;
      let e = plane.edges.get(fid);
      if (!e) {
        e = { id: fid, el: f, kind: 'sequenceFlow', ...ends, points: [] };
        plane.edges.set(fid, e);
        this.newEdges.add(fid);
      } else {
        e.sourceId = ends.sourceId;
        e.targetId = ends.targetId;
      }
      if (LayoutDebug.on()) LayoutDebug.log(`[route] ${fid}: ${this.newEdges.has(fid) ? 'new' : 'end placed'}, routed when ${id} was placed`);
      this.routeKept(plane, e);
    }
    // what the placement broke (the space tool, a new shape on a line) is routed again now, like at the end of a single command
    const detached = !verticalBand(plane);
    for (const e of plane.edges.values()) {
      if (e.kind === 'messageFlow' || e.points.length < 2 || e.sourceId === id || e.targetId === id || !e.sourceId || !e.targetId) continue;
      const ends = edgeEnds(e.el);
      // an end that changes later (a flow into a node still to be placed) is routed when that node is placed
      if (ends.sourceId !== e.sourceId || ends.targetId !== e.targetId || !plane.shapes.has(e.sourceId) || !plane.shapes.has(e.targetId)) continue;
      const was = this.routedNow.get(e.id) ?? this.edgesBefore.get(e);
      if (!was || (!this.drawing(plane).brokenEdge(e, was, { detached }) && !(this.place.continued?.has(id) && this.grazes(plane, e, [id])))) continue;
      if (LayoutDebug.on()) LayoutDebug.log(`[route] ${e.id}: broken when ${id} was placed`);
      this.routeKept(plane, e);
    }
    if (!s.label && hasExternalLabel(s) && raw<string>(el, 'name')) this.drawing(plane).placeShapeLabel(s);
    // the next command would measure the drawing's gap and row spacing again, with these flows
    this.place.spacing.set(plane, spacingOf(plane));
  }

  /** Routes a connection during placement (routeNow) and records its state then. */
  private routeKept(plane: Plane, e: DEdge): void {
    const drawing = this.drawing(plane);
    if (!drawing.reroute(e)) return;
    this.routedNow.set(e.id, drawing.edgeBefore(e));
  }

  /** Room kept free below an activity's text for what sits on its bottom border: a marker, boundary events. */
  private textRoom(plane: Plane, s: DShape): number {
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
  private growForTitle(plane: Plane, s: DShape): void {
    const title = titleOf(s);
    if (!title) return;
    const old = this.oldTitle(s);
    // the depth the title gained (diagram/utils/text.ts titleDepth): its new lines, all of it where none was drawn
    const gained = old ? title.height - old.height : bottom(title) - s.bounds.y;
    if (gained <= 0) return;
    const { shapes, edges } = contentOf(plane, s.id);
    // a message flow's label between the pools is no content, even when the flow leaves a shape in the sub-process
    const under = (b: Box): boolean => b.y >= s.bounds.y && b.y < bottom(s.bounds) && b.x < right(title) + 2 && right(b) > title.x - 2;
    const boxes = [...shapes.flatMap((c) => [c.bounds, ...(c.label ? [c.label] : [])]), ...edges.flatMap((e) => (e.label ? [e.label] : []))].filter(under);
    if (!boxes.length) return;
    const delta = Math.ceil(Math.min(gained, bottom(title) + 4 - Math.min(...boxes.map((b) => b.y))));
    if (delta <= 0) return;
    const r = this.drawing(plane).makeSpace({ axis: 'y', line: s.bounds.y + 1, delta, anchors: [s.id], frame: s.id, within: copyBox(s.bounds) });
    for (const x of [...r.moved, ...r.resized]) this.place.moved.add(x);
    this.place.moved.add(s.id);
    this.notes.push(`${s.id} made ${delta} px of room below its new title`);
  }

  /** Activities whose new name does not fit their box grow, so do expanded sub-processes for their title (module contract, step 6). */
  private growForNames(): void {
    for (const plane of this.planes) {
      const sp = this.place.spacing.get(plane) ?? spacingOf(plane);
      for (const s of [...plane.shapes.values()]) {
        if (this.fromEngine.has(s.id) || (s.kind !== 'task' && s.kind !== 'subProcess')) continue;
        const name = raw<string>(s.el, 'name');
        if (!name || name === this.snap.names.get(this.oldId(s))) continue;
        if (s.container) {
          this.growForTitle(plane, s);
          continue;
        }
        const size = activitySize(name, s.bounds, this.textRoom(plane, s));
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
            // inside a sub-process: frame mode, it never grows over foreign shapes (diagram/SpaceTool.ts)
            const sub = s.parentId ? plane.shapes.get(s.parentId) : undefined;
            const frame = sub ?? (s.poolId ? plane.shapes.get(s.poolId) : undefined);
            const r = this.drawing(plane).makeSpace({ axis: 'x', line: right(old) + 0.5, delta: dw, keep: own, anchors: [s.id], ...(frame ? { within: copyBox(frame.bounds) } : {}), ...(sub ? { frame: sub.id } : {}) });
            for (const x of [...r.moved, ...r.resized]) this.place.moved.add(x);
          }
        }
        s.bounds = { x: old.x, y: Math.round(cy(old) - size.height / 2), width: size.width, height: size.height };
        // never above its frame's interior (fitInFrame grows the frame at the right / bottom)
        const frame = frameOf(plane, s);
        const inner = frame ? frameInterior(frame, 15) : undefined;
        if (inner && s.bounds.y < inner.y) s.bounds.y = Math.round(inner.y);
        this.drawing(plane).reseatBoundaries(s, old);
        for (const x of this.drawing(plane).fitInFrame(s.id, 15).moved) this.place.moved.add(x);
        this.active.add(s.id);
        this.place.moved.add(s.id);
        this.grown.add(s.id);
        this.notes.push(`${s.id} grew to ${size.width}x${size.height} to fit its name`);
      }
    }
  }

  private neighbourIds(id: string): string[] {
    return [...predecessors(this.sem, id), ...successors(this.sem, id)];
  }

  private separateAll(): void {
    const changed = new Set([...this.place.placed, ...this.active, ...this.place.moved]);
    for (const plane of this.planes) {
      const active = [...changed].filter((id) => plane.shapes.has(id) && !this.fromEngine.has(id));
      if (!active.length) continue;
      const movable = new Set(active);
      for (const id of active) for (const n of this.neighbourIds(id)) if (plane.shapes.has(n)) movable.add(n);
      const r = this.drawing(plane).separate({ active: [...active].filter((id) => this.place.placed.has(id) || this.active.has(id)), movable, baseline: this.baseline });
      r.moved.forEach((x) => this.place.moved.add(x));
      r.resized.forEach((x) => this.place.moved.add(x));
      if (r.unresolved.length) this.notes.push(`overlap left: ${r.unresolved.map(([a, b]) => `${a}~${b}`).join(', ')}`);
    }
  }

  /**
   * A new node placed next to an anchor inside a group may reach over the
   * group's border: the group grows around it (groups are drawn around their
   * content; a node half in, half out reads as neither).
   */
  private growGroups(): void {
    for (const plane of this.planes) {
      const groups = [...plane.shapes.values()].filter((g) => g.kind === 'group');
      if (!groups.length) continue;
      for (const id of this.place.placed) {
        const s = plane.shapes.get(id);
        if (!s || !isLeaf(s) || s.kind === 'boundary') continue;
        for (const g of groups) {
          const b = g.bounds;
          if (!overlaps(s.bounds, b) || inside(s.bounds, b, 10)) continue;
          const pad = 15;
          const x = Math.min(b.x, s.bounds.x - pad);
          const y = Math.min(b.y, s.bounds.y - pad);
          g.bounds = { x, y, width: Math.max(right(b), right(s.bounds) + pad) - x, height: Math.max(b.y + b.height, s.bounds.y + s.bounds.height + pad) - y };
          this.place.moved.add(g.id);
        }
      }
    }
  }

  /** Creates DEdges for connections without DI and collects every edge to (re)route. */
  private collectEdges(before: Map<DEdge, EdgeBefore>): void {
    const edges = this.edgeIndex(this.planes);
    for (const el of this.modelOrder(this.doc.definitions)) {
      const id = idOf(el);
      if (!id || !this.isConnection(el)) continue;
      const ends = edgeEnds(el);
      const home = is(el, 'bpmn:MessageFlow') ? homePlane(this.planes, this.sem, id) : this.planes.find((p) => (!ends.sourceId || p.shapes.has(ends.sourceId) || p.edges.has(ends.sourceId)) && (!ends.targetId || p.shapes.has(ends.targetId) || p.edges.has(ends.targetId)));
      const have = edges.get(id);
      if (!home) continue;
      if (have && have.plane !== home) {
        have.plane.edges.delete(id);
        home.edges.set(id, have.edge);
        this.reroute.add(id);
      } else if (!have) {
        home.edges.set(id, { id, el, kind: edgeKind(el), ...ends, points: [] });
        this.newEdges.add(id);
      }
    }
    for (const plane of this.planes) {
      // a line that does not reach its ends is routed again, except where nothing may be routed (vertical pools / lanes: it stays, as drawn)
      const detached = !verticalBand(plane);
      for (const e of plane.edges.values()) {
        if (this.fromEngine.has(e.id)) continue;
        // routed when its second end was placed: kept unless it broke since
        const now = this.routedNow.get(e.id);
        if (now) {
          const ends = edgeEnds(e.el);
          if (ends.sourceId === e.sourceId && ends.targetId === e.targetId && e.points.length >= 2 && !this.drawing(plane).brokenEdge(e, now, { detached }) && !this.grazes(plane, e, this.place.continued)) continue;
          this.reroute.add(e.id);
          if (LayoutDebug.on()) LayoutDebug.log(`[route] ${e.id}: broken after it was routed`);
          continue;
        }
        if (this.newEdges.has(e.id)) {
          this.reroute.add(e.id);
          continue;
        }
        const old = e.di ? this.snap.byDi.get(e.di) : undefined;
        const ends = edgeEnds(e.el);
        e.sourceId = ends.sourceId;
        e.targetId = ends.targetId;
        // the ends compared by their ids now: renaming an end (`set id=`) changes nothing here
        const why =
          old && (this.cur(old.sourceId) !== ends.sourceId || this.cur(old.targetId) !== ends.targetId)
            ? 'ends changed'
            : (e.sourceId && this.place.placed.has(e.sourceId)) || (e.targetId && this.place.placed.has(e.targetId))
              ? 'end placed'
              : this.drawing(plane).brokenEdge(e, before.get(e), { detached })
                ? 'broken'
                : this.grazes(plane, e, this.place.continued)
                  ? 'runs along a new shape'
                  : undefined;
        if (why) {
          this.reroute.add(e.id);
          if (LayoutDebug.on()) LayoutDebug.log(`[route] ${e.id}: ${why}`);
        }
      }
    }
  }

  /**
   * Whether a connection runs along the border of one of `ids` or touches it:
   * no `through` (the line does not enter the box), but it reads as docking
   * on the shape. Checked for the nodes that continue a chain (placed on their
   * anchor's row without a row choice, NodePlacer.continued: an end event placed
   * on a line an earlier command routed down there). Its own ends, their
   * boundary events and hosts do not count.
   */
  private grazes(plane: Plane, e: DEdge, ids: Iterable<string> | undefined): boolean {
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

  private routeAll(): string[] {
    const rerouted: string[] = [];
    for (const plane of this.planes) {
      // message flows after the sequence flows (they cross the pools and should see the final sequence flows), connections docked on a connection last
      const drawing = this.drawing(plane);
      const pending = drawing.routeOrder([...plane.edges.values()].filter((e) => this.reroute.has(e.id)));
      const waiting = new Set(pending.map((e) => e.id));
      for (const e of pending) {
        const lines = drawing.routingLines(e.id).filter((l) => ![...waiting].some((id) => plane.edges.get(id)?.points === l));
        const routed = drawing.reroute(e, { lines });
        waiting.delete(e.id);
        if (!routed) {
          if (!e.points.length) {
            plane.edges.delete(e.id);
            this.newEdges.delete(e.id);
            this.notes.push(`${e.id} not drawn: an end has no shape on its diagram`);
          }
          continue;
        }
        if (!this.newEdges.has(e.id)) rerouted.push(e.id);
      }
    }
    return rerouted;
  }

  private labels(routed: ReadonlySet<string>): void {
    for (const plane of this.planes) {
      // segments of connections drawn in this run: an existing label they run over steps aside
      const fresh = [...plane.edges.values()].filter((e) => routed.has(e.id)).flatMap((e) => e.points.slice(1).map((q, i) => [e.points[i]!, q] as const));
      const grown = [...this.grown].map((id) => plane.shapes.get(id)).filter((g): g is DShape => !!g);
      for (const s of plane.shapes.values()) {
        if (this.fromEngine.has(s.id)) continue;
        if ((this.place.placed.has(s.id) && !s.label) || (this.place.relabel?.has(s.id) && hasExternalLabel(s))) {
          this.drawing(plane).placeShapeLabel(s);
          continue;
        }
        if (s.label && hasExternalLabel(s) && fresh.some(([p, q]) => segmentHits(p, q, s.label!, 1))) {
          this.drawing(plane).placeShapeLabel(s);
          this.notes.push(`label of ${s.id} moved off a new line`);
          continue;
        }
        if (s.label && hasExternalLabel(s) && grown.some((g) => g !== s && overlaps(s.label!, g.bounds))) {
          this.drawing(plane).placeShapeLabel(s);
          this.notes.push(`label of ${s.id} moved off a grown shape`);
          continue;
        }
        const before = this.snap.names.get(this.oldId(s));
        const now = raw<string>(s.el, 'name');
        if (now && now !== before) this.drawing(plane).refitLabel(s);
      }
      for (const e of plane.edges.values()) {
        if (this.fromEngine.has(e.id) || this.reroute.has(e.id)) continue;
        const before = this.snap.names.get(this.oldId(e));
        const now = raw<string>(e.el, 'name');
        if (now && now !== before) this.drawing(plane).refitLabel(e);
      }
      // a label now on the title of an expanded sub-process that it was clear of (room made under it, a wider new title)
      for (const [id, sub] of this.drawing(plane).clearTitles((o, sub) => !this.fromEngine.has(o.id) && this.clearOfOldTitle(o, sub))) this.notes.push(`label of ${id} moved off the name of ${sub}`);
    }
  }

  /** The title an expanded sub-process had before the ops (diagram/utils/text.ts titleBox of its snapshot bounds and name); undefined without one. */
  private oldTitle(s: DShape): Box | undefined {
    const was = s.di ? this.snap.byDi.get(s.di) : undefined;
    return was?.bounds && was.kind === 'subProcess' && was.expanded === true ? titleBox(was.bounds, this.snap.names.get(was.id)) : undefined;
  }

  /** Whether a label was clear of the title of `sub` before the ops (a label or a title that did not exist was). */
  private clearOfOldTitle(owner: DShape | DEdge, sub: DShape): boolean {
    const label = owner.di ? this.snap.byDi.get(owner.di)?.label : undefined;
    const title = this.oldTitle(sub);
    return !label || !title || !overlaps(label, title);
  }

  /** Everything the drawing of the new elements (steps 6 to 9) changes, to undo it. */
  checkpoint(): Checkpoint {
    const cp: Checkpoint = {
      planes: [...this.planes],
      members: new Map(),
      shapes: new Map(),
      edges: new Map(),
      placer: this.place.checkpoint(),
      sets: {
        reroute: new Set(this.reroute),
        newEdges: new Set(this.newEdges),
        fromEngine: new Set(this.fromEngine),
        active: new Set(this.active),
        relocated: new Set(this.relocated),
        grown: new Set(this.grown),
        routedNow: new Map(this.routedNow),
      },
      notes: [...this.notes],
    };
    const keepShape = (s: DShape): void => {
      if (!cp.shapes.has(s)) cp.shapes.set(s, { bounds: copyBox(s.bounds), ...(s.label ? { label: copyBox(s.label) } : {}) });
    };
    const keepEdge = (e: DEdge): void => {
      if (!cp.edges.has(e)) cp.edges.set(e, { points: copyPoints(e.points), ...(e.label ? { label: copyBox(e.label) } : {}), ...(e.sourceId ? { sourceId: e.sourceId } : {}), ...(e.targetId ? { targetId: e.targetId } : {}) });
    };
    for (const plane of this.planes) {
      cp.members.set(plane, { shapes: [...plane.shapes.values()], edges: [...plane.edges.values()] });
      plane.shapes.forEach(keepShape);
      plane.edges.forEach(keepEdge);
    }
    // shapes waiting to be placed again (their DI is reused): their boundary events and content move along
    for (const r of this.place.reuse.values()) {
      [r.shape, ...r.boundaries, ...(r.content?.shapes ?? [])].forEach(keepShape);
      (r.content?.edges ?? []).forEach(keepEdge);
    }
    return cp;
  }

  restore(cp: Checkpoint): void {
    this.planes.length = 0;
    this.planes.push(...cp.planes);
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
    this.place.restore(cp.placer);
    const s = cp.sets;
    Object.assign(this, { reroute: new Set(s.reroute), newEdges: new Set(s.newEdges), fromEngine: new Set(s.fromEngine), active: new Set(s.active), relocated: new Set(s.relocated), grown: new Set(s.grown), routedNow: new Map(s.routedNow) });
    this.notes.splice(0, this.notes.length, ...cp.notes);
  }

  private movedShapes(): string[] {
    const out: string[] = [];
    for (const plane of this.planes) {
      for (const s of plane.shapes.values()) {
        if (!s.di || (this.place.placed.has(s.id) && !this.relocated.has(s.id))) continue;
        const old = this.snap.byDi.get(s.di);
        if (old?.bounds && !sameBox(old.bounds, s.bounds)) out.push(s.id);
      }
    }
    for (const id of this.relocated) if (!out.includes(id)) out.push(id);
    return out;
  }

  /**
   * Vertical pools and lanes (isHorizontal=false) are not supported: the
   * placement, the space tool and the router all work on horizontal bands. A
   * run that would place, move or route anything on a plane with one fails
   * (auto mode then redraws in full, a requested incremental layout is refused);
   * pruning and label refits are fine.
   */
  private assertHorizontal(rerouted: readonly string[]): void {
    const changed = new Set([...this.place.placed, ...this.place.moved, ...rerouted, ...this.newEdges]);
    for (const plane of this.planes) {
      const vertical = verticalBand(plane);
      if (!vertical) continue;
      const touched = [...changed].filter((id) => plane.shapes.has(id) || plane.edges.has(id));
      if (touched.length) throw new Error(`${vertical.kind === 'lane' ? 'lane' : 'pool'} ${vertical.id} is drawn vertically (isHorizontal=false); the incremental layout only edits horizontal pools and lanes (it would have changed ${touched.slice(0, 3).join(', ')})`);
    }
  }
}
