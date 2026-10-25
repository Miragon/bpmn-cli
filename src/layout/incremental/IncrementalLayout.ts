import { CrossingRepair } from './CrossingRepair.js';
import { DuplicateDiGuard } from './DuplicateDiGuard.js';
import { EngineDrawing, type Block } from '../EngineDrawing.js';
import type { Snapshot } from './Snapshot.js';
import { DrawingDiff } from './DrawingDiff.js';
import { JoinPuller } from './JoinPuller.js';
import { IncrementalRouting } from './IncrementalRouting.js';
import { FrameGrowth } from './FrameGrowth.js';
import { LabelRefresh } from './LabelRefresh.js';
import { RunCheckpoint } from './RunCheckpoint.js';
import type { Doc } from '../../model/Doc.js';
import { is, layoutRoot, type El } from '../../model/utils/moddle.js';
import { copyBox, sameBox, samePoints, type Box, type Point } from '../../drawing/utils/geom.js';
import { NodePlacer, type PlacementHooks, type PlacerState } from './NodePlacer.js';
import { idOf, raw, rawList } from '../../drawing/utils/raw.js';
import { DiagramReader } from '../../drawing/DiagramReader.js';
import { PlaneQuery } from '../../drawing/PlaneQuery.js';
import { Semantics } from '../../drawing/Semantics.js';
import type { DEdge, DShape, Plane } from '../../drawing/types.js';
import type { EdgeBefore } from './EdgeRouter.js';
import { titleBox } from '../../drawing/utils/text.js';
import { DiPruner } from '../../drawing/DiPruner.js';
import { PlaneWriter } from '../../drawing/PlaneWriter.js';
import { Drawing } from '../../drawing/Drawing.js';

export interface IncrementalReport {
  mode: 'incremental';
  placed: string[];
  moved: string[];
  rerouted: string[];
  /** pre-existing connections the space tool stretched without routing them again */
  reshaped: string[];
  pruned: string[];
  notes: string[];
}

export interface IncrementalOptions {
  /** nodes the ops re-inserted elsewhere in the flow (move --after/--before/--flow/--in) */
  relocated?: Iterable<string>;
  /** ids the ops created, in op order: new nodes are placed in it where their neighbours allow */
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

/**
 * Incremental layout after the ops ran: keeps the drawing, prunes what was removed, places what is
 * new like single commands would, makes room like the modeler's space tool and reroutes only the
 * connections that need it. Untouched shapes and connections keep their exact DI; nothing is
 * placed, moved or routed on a plane with vertical pools / lanes (an error: auto mode redraws).
 */
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
  /** flows routed when their second end was placed: their state then (did they break since?) */
  routedNow = new Map<string, EdgeBefore>();
  /** ids the ops created, in op order (IncrementalOptions.created) */
  private readonly created: readonly string[];
  /** every connection's state before anything moved (brokenEdge) */
  private readonly edgesBefore = new Map<DEdge, EdgeBefore>();
  /** sequence flows whose source / target changed: their ids before the ops */
  private readonly oldSource = new Map<string, string>();
  private readonly oldTarget = new Map<string, string>();
  private engineRun?: Promise<EngineDrawing>;
  private readonly diff: DrawingDiff;
  private readonly joinPuller: JoinPuller;
  private readonly routing: IncrementalRouting;
  private readonly growth: FrameGrowth;
  private readonly labelRefresh: LabelRefresh;
  private readonly checkpoints: RunCheckpoint;
  afterPlace?: (plane: Plane, s: DShape) => void;
  afterNode?: (plane: Plane, id: string) => void;

  /** Incremental layout of a document after its ops ran. */
  static async run(doc: Doc, snap: Snapshot, opts: IncrementalOptions = {}): Promise<IncrementalReport> {
    const sem = Semantics.of(doc.definitions);
    const prunedNow = DiPruner.prune(doc.definitions, sem);
    // a further view is not drawn: an edge of a flow whose ends changed would show the old ends
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
    // a further diagram of a root another diagram shows is a second view: left as it is
    this.planes = new DiagramReader(doc.definitions, sem).planes().filter((p, i, all) => all.findIndex((q) => q.rootId === p.rootId) === i);
    for (const [oldFlowId, ends] of snap.flowEnds) {
      const id = snap.currentId(oldFlowId);
      const el = sem.byId.get(id);
      if (!el) continue;
      const now = DiagramReader.edgeEnds(el);
      // the old ends by their ids now (a renamed end is the same end)
      const source = snap.currentId(ends.sourceId);
      const target = snap.currentId(ends.targetId);
      if (source && now.sourceId !== source) this.oldSource.set(id, source);
      if (target && now.targetId !== target) this.oldTarget.set(id, target);
    }
    if (stale.length) this.notes.push(`edge(s) of ${[...new Set(stale)].join(', ')} removed from a further diagram of the same root: their ends changed, and further diagrams are not laid out`);
    const baseline = new Map(this.planes.flatMap((p) => [...p.shapes.values()].map((x) => [x.id, copyBox(x.bounds)] as [string, Box])));
    this.created = opts.created ?? [];
    this.place = new NodePlacer(this.planes, sem, this.oldSource, this.oldTarget, new Set(opts.collapse ?? []), this.notes, this);
    this.diff = new DrawingDiff(this, snap);
    this.joinPuller = new JoinPuller(this, snap);
    this.routing = new IncrementalRouting(this, snap, this.edgesBefore);
    this.growth = new FrameGrowth(this, snap, baseline);
    this.labelRefresh = new LabelRefresh(this, snap);
    this.checkpoints = new RunCheckpoint(this);
  }

  private async layout(prunedNow: readonly string[], duplicates: DuplicateDiGuard): Promise<IncrementalReport> {
    const defs = this.doc.definitions;
    const before = this.edgesBefore;
    /**
     * connections that do not reach an end of theirs (not one whose ends the ops changed) are
     * broken whatever they were before: routed again, a note says why
     */
    const detached = new Map<string, string[]>();
    for (const plane of this.planes) {
      const vertical = !!PlaneQuery.verticalBand(plane);
      for (const e of plane.edges.values()) {
        before.set(e, this.drawing(plane).edgeBefore(e));
        const ends = vertical ? [] : this.drawing(plane).detachedEnds(e);
        if (ends.length && !(e.di && this.snap.changedEnds(e.di).length)) detached.set(e.id, ends);
      }
    }

    const wrapped = this.followRoot();
    const strips = this.diff.removedAndRelocated(new Set(this.opts.relocated ?? []));
    const ignore = new Set<string>([...this.reroute, ...this.oldSource.keys(), ...this.oldTarget.keys()]);
    this.diff.closeStrips(strips, ignore);
    this.diff.applyExpansion(this.opts);
    await this.placeContainers(wrapped);
    this.diff.laneChanges();
    this.joinPuller.pullJoins();
    const start = this.checkpoint();
    const rerouted = await new CrossingRepair(this).repair(await this.draw(), start, () => this.draw());
    for (const id of new Set(rerouted)) {
      const ends = detached.get(id);
      if (ends) this.notes.push(`${id} routed again: it did not reach ${ends.join(' and ')}`);
    }
    new PlaneWriter(this.doc.moddle, defs).write(this.planes);
    this.doc.invalidate();
    duplicates.assertNone(defs);

    const live = new Set<El>();
    for (const p of this.planes) for (const x of [...p.shapes.values(), ...p.edges.values()]) if (x.di) live.add(x.di);
    const pruned = new Set(prunedNow);
    for (const [di, entry] of this.snap.byDi) if (!live.has(di) && !this.sem.byId.has(entry.id)) pruned.add(entry.id);
    // connections the space tool stretched or shortened without routing them again (audit #61)
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

  /** Place, grow, separate, route, label; the local repair runs them again from a checkpoint. */
  private async draw(): Promise<string[]> {
    await this.placeNodes();
    this.growth.growForNames();
    this.growth.separateAll();
    this.growth.growGroups();
    this.routing.collectEdges(this.edgesBefore);
    const r = this.routing.routeAll();
    // existing connections routed when an end was placed and kept since count as rerouted
    for (const id of this.routedNow.keys()) if (!this.newEdges.has(id) && !r.includes(id) && this.planes.some((p) => p.edges.has(id))) r.push(id);
    this.labelRefresh.labels(new Set([...r, ...this.newEdges]));
    this.assertHorizontal(r);
    return r;
  }

  /** Flow nodes, artifacts and connections of the model, parents before children. */
  modelOrder(defs: El): El[] {
    const out: El[] = [];
    const visitScope = (scope: El): void => {
      for (const fe of rawList(scope, 'flowElements')) {
        out.push(fe);
        for (const da of [...rawList(fe, 'dataInputAssociations'), ...rawList(fe, 'dataOutputAssociations')]) out.push(da);
        if (Semantics.isSubProcess(fe)) visitScope(fe);
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

  private isFlowNode(el: El): boolean {
    return is(el, 'bpmn:FlowNode');
  }

  private isArtifactShape(el: El): boolean {
    return is(el, 'bpmn:DataObjectReference') || is(el, 'bpmn:DataStoreReference') || is(el, 'bpmn:TextAnnotation');
  }

  /** Copies engine geometry onto `plane` (shifted by dx/dy), bound to the document's elements. */
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
      const copy: DEdge = { id: e.id, el, kind: DiagramReader.edgeKind(el), ...DiagramReader.edgeEnds(el), points: e.points.map((p) => ({ x: p.x + ox, y: p.y + oy })) };
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
      if (scope && sid && Semantics.isSubProcess(scope) && plane.shapes.get(sid)?.expanded) s.parentId = sid;
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

  /** What the clean engine draws for the document, laid out once when a block of it is needed. */
  private engineDrawing(): Promise<EngineDrawing> {
    return (this.engineRun ??= EngineDrawing.of(this.doc, this.opts));
  }

  /** The drawing of a plane in this run: what its frame edits move counts as moved. */
  drawing(plane: Plane): Drawing {
    return new Drawing(plane, this.place.moved);
  }

  /** The id an element had before the ops (its DI object survives a `set id=` rename). */
  oldId(x: DShape | DEdge): string {
    return (x.di && this.snap.byDi.get(x.di)?.id) || x.id;
  }

  /** The id now of an element known by its id before the ops. */
  cur(id: string | undefined): string | undefined {
    return this.snap.currentId(id);
  }

  /** The title an expanded sub-process had before the ops; undefined without one. */
  oldTitle(s: DShape): Box | undefined {
    const was = s.di ? this.snap.byDi.get(s.di) : undefined;
    return was?.bounds && was.kind === 'subProcess' && was.expanded === true ? titleBox(was.bounds, this.snap.names.get(was.id)) : undefined;
  }

  /** A plane for a collapsed sub-process that has none yet. */
  planeFor(id: string): Plane | undefined {
    const home = this.sem.homePlane(this.planes, id);
    if (home) return home;
    const el = this.sem.byId.get(id);
    if (!el) return undefined;
    const anchor = is(el, 'bpmn:DataAssociation') ? idOf(el.$parent) : id;
    const scope = anchor ? this.sem.scopeOf.get(anchor) : undefined;
    const sid = idOf(scope);
    if (!scope || !sid || !Semantics.isSubProcess(scope)) return undefined;
    // only for a sub-process drawn collapsed (one still to be expanded gets its content later)
    const shape = this.planes.map((p) => p.shapes.get(sid)).find((x) => !!x);
    if (shape?.expanded) return undefined;
    if (!shape && !(this.place.collapsed.has(sid) && this.planeFor(sid))) return undefined;
    const plane: Plane = { id: `BPMNPlane_${sid}`, rootId: sid, root: scope, shapes: new Map(), edges: new Map(), dropped: [] };
    this.planes.push(plane);
    return plane;
  }

  /** Re-points the root plane at a new collaboration; returns the pool wrapping the old process. */
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

  private async placeContainers(wrapped: string | undefined): Promise<void> {
    const shapes = this.shapeIndex(this.planes);
    for (const el of this.modelOrder(this.doc.definitions)) {
      const id = idOf(el);
      if (!id || shapes.has(id)) continue;
      if (is(el, 'bpmn:Participant')) {
        const plane = this.sem.homePlane(this.planes, id);
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
        const plane = this.sem.homePlane(this.planes, id);
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

  /**
   * New flow nodes and artifacts in op order; new expanded sub-processes with content (and
   * collapsed ones whose content has no DI) come from the engine as one block.
   */
  private async placeNodes(): Promise<void> {
    const drawn = (id: string): boolean => this.planes.some((p) => p.shapes.has(id));
    const order = this.modelOrder(this.doc.definitions);
    // new nodes in op order (the model lists an inserted node next to its anchor), then model order
    const rank = new Map(this.created.map((id, i) => [id, i]));
    const pendingNodes = order
      .filter((el) => this.isFlowNode(el) && idOf(el) && !drawn(idOf(el)!))
      .map((el) => idOf(el)!)
      .map((id, i) => ({ id, key: rank.get(id) ?? this.created.length + i }))
      .sort((a, b) => a.key - b.key)
      .map((x) => x.id);
    const blockRoots = pendingNodes.filter((id) => {
      const el = this.sem.byId.get(id)!;
      return Semantics.isSubProcess(el) && !this.place.collapsed.has(id) && rawList(el, 'flowElements').some(this.isFlowNode) && !this.place.reuse.has(id);
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
    for (const id of pendingNodes) {
      const scope = this.sem.scopeOf.get(id);
      const sid = idOf(scope);
      if (!scope || !sid || !Semantics.isSubProcess(scope) || inBlock.has(id) || this.planes.some((p) => p.rootId === sid)) continue;
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
    this.afterNode = (plane: Plane, id: string): void => this.routing.routeNow(plane, id);
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

  /** Everything the drawing of the new elements (steps 6 to 9) changes, to undo it. */
  checkpoint(): Checkpoint {
    return this.checkpoints.take();
  }

  restore(cp: Checkpoint): void {
    this.checkpoints.restore(cp);
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
   * Vertical pools and lanes are not supported (placement, space tool and router work on
   * horizontal bands): a run that would place, move or route anything on such a plane fails.
   */
  private assertHorizontal(rerouted: readonly string[]): void {
    const changed = new Set([...this.place.placed, ...this.place.moved, ...rerouted, ...this.newEdges]);
    for (const plane of this.planes) {
      const vertical = PlaneQuery.verticalBand(plane);
      if (!vertical) continue;
      const touched = [...changed].filter((id) => plane.shapes.has(id) || plane.edges.has(id));
      if (touched.length) throw new Error(`${vertical.kind === 'lane' ? 'lane' : 'pool'} ${vertical.id} is drawn vertically (isHorizontal=false); the incremental layout only edits horizontal pools and lanes (it would have changed ${touched.slice(0, 3).join(', ')})`);
    }
  }
}
