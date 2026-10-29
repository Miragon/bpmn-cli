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
import type { DrawingCheckpoint } from '../../di/DrawingCheckpoint.js';
import type { Doc } from '../../../document/Doc.js';
import { is, layoutRoot, type El } from '../../../document/utils/moddle.js';
import { copyBox, sameBox, samePoints, type Box } from '../../utils/geom.js';
import { NodePlacer, type PlacementHooks, type PlacerState } from './NodePlacer.js';
import { idOf, raw, rawList } from '../../utils/raw.js';
import { DiagramReader } from '../../di/DiagramReader.js';
import { PlaneQuery } from '../../di/PlaneQuery.js';
import { Semantics } from '../../di/Semantics.js';
import type { DEdge, DShape, Plane } from '../../di/types.js';
import type { EdgeBefore } from './EdgeRouter.js';
import { titleBox } from '../../utils/text.js';
import { DiPruner } from '../../di/DiPruner.js';
import { PlaneWriter } from '../../di/PlaneWriter.js';
import { Drawing } from './Drawing.js';

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
  drawing: DrawingCheckpoint;
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
  afterPlace?: (plane: Plane, shape: DShape) => void;
  afterNode?: (plane: Plane, id: string) => void;

  /**
   * Incremental layout of a document after its ops ran.
   * Edges of flows whose ends changed are pruned from further views, which are not drawn and would
   * show the old ends.
   */
  static async run(doc: Doc, snap: Snapshot, opts: IncrementalOptions = {}): Promise<IncrementalReport> {
    const sem = Semantics.of(doc.definitions);
    const prunedNow = DiPruner.prune(doc.definitions, sem);
    const stale = snap.pruneReEnded(doc.definitions, { further: true });
    const duplicates = new DuplicateDiGuard(doc.definitions);
    return new IncrementalLayout(doc, snap, opts, sem, stale).layout(prunedNow, duplicates);
  }

  /**
   * A further diagram of a root another diagram shows is a second view and is left as it is. Old
   * flow ends are taken by their ids now, so a renamed end is the same end.
   */
  private constructor(
    readonly doc: Doc,
    private readonly snap: Snapshot,
    private readonly opts: IncrementalOptions,
    sem: Semantics,
    stale: readonly string[],
  ) {
    this.sem = sem;
    this.planes = new DiagramReader(doc.definitions, sem).planes().filter((plane, index, all) => all.findIndex((other) => other.rootId === plane.rootId) === index);
    for (const [oldFlowId, ends] of snap.flowEnds) {
      const id = snap.currentId(oldFlowId);
      const el = sem.byId.get(id);
      if (!el) continue;
      const now = DiagramReader.edgeEnds(el);
      const source = snap.currentId(ends.sourceId);
      const target = snap.currentId(ends.targetId);
      if (source && now.sourceId !== source) this.oldSource.set(id, source);
      if (target && now.targetId !== target) this.oldTarget.set(id, target);
    }
    if (stale.length) {
      this.notes.push(`edge(s) of ${[...new Set(stale)].join(', ')} removed from a further diagram of the same root: their ends changed, and further diagrams are not laid out`);
    }
    const baseline = new Map(this.planes.flatMap((plane) => [...plane.shapes.values()].map((shape) => [shape.id, copyBox(shape.bounds)] as [string, Box])));
    this.created = opts.created ?? [];
    this.place = new NodePlacer(this.planes, sem, this.oldSource, this.oldTarget, new Set(opts.collapse ?? []), this.notes, this);
    this.diff = new DrawingDiff(this, snap);
    this.joinPuller = new JoinPuller(this, snap);
    this.routing = new IncrementalRouting(this, snap, this.edgesBefore);
    this.growth = new FrameGrowth(this, snap, baseline);
    this.labelRefresh = new LabelRefresh(this, snap);
    this.checkpoints = new RunCheckpoint(this);
  }

  /**
   * Reports as reshaped the connections the space tool stretched or shortened without routing them
   * again (audit #61).
   */
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
      for (const edge of plane.edges.values()) {
        before.set(edge, this.drawing(plane).edgeBefore(edge));
        const ends = vertical ? [] : this.drawing(plane).detachedEnds(edge);
        if (ends.length && !(edge.di && this.snap.changedEnds(edge.di).length)) {
          detached.set(edge.id, ends);
        }
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
    this.joinPuller.pushTargets();
    const start = this.checkpoint();
    const rerouted = await new CrossingRepair(this).repair(await this.draw(), start, () => this.draw());
    for (const id of this.routing.routeGrazed()) {
      if (!rerouted.includes(id)) rerouted.push(id);
    }
    for (const id of new Set(rerouted)) {
      const ends = detached.get(id);
      if (ends) {
        this.notes.push(`${id} routed again: it did not reach ${ends.join(' and ')}`);
      }
    }
    new PlaneWriter(this.doc.moddle, defs).write(this.planes);
    this.doc.invalidate();
    duplicates.assertNone(defs);

    const live = new Set<El>();
    for (const plane of this.planes) {
      for (const element of [...plane.shapes.values(), ...plane.edges.values()]) {
        if (element.di) live.add(element.di);
      }
    }
    const pruned = new Set(prunedNow);
    for (const [di, entry] of this.snap.byDi) {
      if (!live.has(di) && !this.sem.byId.has(entry.id)) pruned.add(entry.id);
    }
    const routed = new Set([...rerouted, ...this.newEdges]);
    const reshaped: string[] = [];
    for (const [edge, edgeBefore] of before) {
      if (!routed.has(edge.id) && !pruned.has(edge.id) && !samePoints(edgeBefore.points, edge.points)) {
        reshaped.push(edge.id);
      }
    }
    return {
      mode: 'incremental',
      placed: [...this.place.placed, ...this.newEdges].filter((id, index, all) => all.indexOf(id) === index && !this.relocated.has(id)),
      moved: this.movedShapes(),
      rerouted,
      reshaped: reshaped.filter((id, index) => reshaped.indexOf(id) === index),
      pruned: [...pruned],
      notes: this.notes,
    };
  }

  /**
   * Place, grow, separate, route, label; the local repair runs them again from a checkpoint.
   * Existing connections routed when an end was placed and kept since count as rerouted.
   */
  private async draw(): Promise<string[]> {
    await this.placeNodes();
    this.growth.growForNames();
    this.growth.separateAll();
    this.growth.growGroups();
    this.routing.collectEdges(this.edgesBefore);
    const rerouted = this.routing.routeAll();
    for (const id of this.routedNow.keys()) {
      if (!this.newEdges.has(id) && !rerouted.includes(id) && this.planes.some((plane) => plane.edges.has(id))) {
        rerouted.push(id);
      }
    }
    this.labelRefresh.labels(new Set([...rerouted, ...this.newEdges]));
    this.assertHorizontal(rerouted);
    return rerouted;
  }

  /** Flow nodes, artifacts and connections of the model, parents before children. */
  modelOrder(defs: El): El[] {
    const out: El[] = [];
    const visitScope = (scope: El): void => {
      for (const fe of rawList(scope, 'flowElements')) {
        out.push(fe);
        for (const da of [...rawList(fe, 'dataInputAssociations'), ...rawList(fe, 'dataOutputAssociations')]) {
          out.push(da);
        }
        if (Semantics.isSubProcess(fe)) visitScope(fe);
      }
      for (const artifact of rawList(scope, 'artifacts')) {
        out.push(artifact);
      }
    };
    for (const root of rawList(defs, 'rootElements')) {
      if (is(root, 'bpmn:Collaboration')) {
        for (const participant of rawList(root, 'participants')) {
          out.push(participant);
        }
        for (const messageFlow of rawList(root, 'messageFlows')) {
          out.push(messageFlow);
        }
        for (const artifact of rawList(root, 'artifacts')) {
          out.push(artifact);
        }
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
    for (const plane of planes) {
      for (const shape of plane.shapes.values()) {
        out.set(shape.id, { plane, shape });
      }
    }
    return out;
  }

  private isFlowNode(el: El): boolean {
    return is(el, 'bpmn:FlowNode');
  }

  private isArtifactShape(el: El): boolean {
    return is(el, 'bpmn:DataObjectReference') || is(el, 'bpmn:DataStoreReference') || is(el, 'bpmn:TextAnnotation');
  }

  /**
   * Copies engine geometry onto `plane` (shifted by dx/dy), bound to the document's elements.
   * Containers go first, so the content's membership (parentId) resolves.
   */
  private adoptBlock(plane: Plane, block: Block, dx: number, dy: number): void {
    const rebindShape = (shape: DShape, target: Plane, ox: number, oy: number): void => {
      const el = this.sem.byId.get(shape.id);
      if (!el || target.shapes.has(shape.id)) return;
      const copy = this.place.newShape(target, shape.id, { x: shape.bounds.x + ox, y: shape.bounds.y + oy, width: shape.bounds.width, height: shape.bounds.height });
      if (shape.label) {
        copy.label = { ...shape.label, x: shape.label.x + ox, y: shape.label.y + oy };
      }
      if (shape.kind === 'subProcess') {
        copy.expanded = shape.expanded === true;
        copy.container = shape.expanded === true;
      }
      target.shapes.set(shape.id, copy);
      this.place.placed.add(shape.id);
      this.fromEngine.add(shape.id);
    };
    const rebindEdge = (edge: DEdge, target: Plane, ox: number, oy: number): void => {
      const el = this.sem.byId.get(edge.id);
      if (!el || target.edges.has(edge.id)) return;
      const copy: DEdge = { id: edge.id, el, kind: DiagramReader.edgeKind(el), ...DiagramReader.edgeEnds(el), points: edge.points.map((point) => ({ x: point.x + ox, y: point.y + oy })) };
      if (edge.label) {
        copy.label = { ...edge.label, x: edge.label.x + ox, y: edge.label.y + oy };
      }
      target.edges.set(edge.id, copy);
      this.fromEngine.add(edge.id);
      this.newEdges.add(edge.id);
    };
    for (const shape of [...block.shapes].sort((first, second) => Number(second.container) - Number(first.container))) {
      rebindShape(shape, plane, dx, dy);
    }
    for (const shape of plane.shapes.values()) {
      if (!this.fromEngine.has(shape.id)) continue;
      const scope = this.sem.scopeOf.get(shape.id);
      const sid = idOf(scope);
      if (scope && sid && Semantics.isSubProcess(scope) && plane.shapes.get(sid)?.expanded) {
        shape.parentId = sid;
      }
    }
    for (const edge of block.edges) {
      rebindEdge(edge, plane, dx, dy);
    }
    for (const blockPlane of block.planes) {
      const root = this.sem.byId.get(blockPlane.rootId);
      if (!root || this.planes.some((existing) => existing.rootId === blockPlane.rootId)) {
        continue;
      }
      const target: Plane = { id: `BPMNPlane_${blockPlane.rootId}`, rootId: blockPlane.rootId, root, shapes: new Map(), edges: new Map(), dropped: [] };
      this.planes.push(target);
      for (const shape of blockPlane.shapes.values()) {
        rebindShape(shape, target, 0, 0);
      }
      for (const edge of blockPlane.edges.values()) {
        rebindEdge(edge, target, 0, 0);
      }
    }
  }

  /** What the clean engine draws for the document, laid out once when a block of it is needed. */
  private engineDrawing(): Promise<EngineDrawing> {
    return (this.engineRun ??= EngineDrawing.of(this.doc, this.opts));
  }

  /**
   * The drawing of a plane in this run: what its frame edits move counts as moved, associations
   * keep clear of the nodes placed.
   */
  drawing(plane: Plane): Drawing {
    return new Drawing(plane, this.place.moved, this.place.placed);
  }

  /** The id an element had before the ops (its DI object survives a `set id=` rename). */
  oldId(element: DShape | DEdge): string {
    return (element.di && this.snap.byDi.get(element.di)?.id) || element.id;
  }

  /** The id now of an element known by its id before the ops. */
  cur(id: string | undefined): string | undefined {
    return this.snap.currentId(id);
  }

  /** The title an expanded sub-process had before the ops; undefined without one. */
  oldTitle(shape: DShape): Box | undefined {
    const was = shape.di ? this.snap.byDi.get(shape.di) : undefined;
    return was?.bounds && was.kind === 'subProcess' && was.expanded === true ? titleBox(was.bounds, this.snap.names.get(was.id)) : undefined;
  }

  /**
   * A plane for a collapsed sub-process that has none yet.
   * Only for a sub-process drawn collapsed: one still to be expanded gets its content later.
   */
  planeFor(id: string): Plane | undefined {
    const home = this.sem.homePlane(this.planes, id);
    if (home) return home;
    const el = this.sem.byId.get(id);
    if (!el) return undefined;
    const anchor = is(el, 'bpmn:DataAssociation') ? idOf(el.$parent) : id;
    const scope = anchor ? this.sem.scopeOf.get(anchor) : undefined;
    const sid = idOf(scope);
    if (!scope || !sid || !Semantics.isSubProcess(scope)) return undefined;
    const shape = this.planes.map((plane) => plane.shapes.get(sid)).find((candidate) => !!candidate);
    if (shape?.expanded) return undefined;
    if (!shape && !(this.place.collapsed.has(sid) && this.planeFor(sid))) {
      return undefined;
    }
    const plane: Plane = { id: `BPMNPlane_${sid}`, rootId: sid, root: scope, shapes: new Map(), edges: new Map(), dropped: [] };
    this.planes.push(plane);
    return plane;
  }

  /**
   * Re-points the root plane at a new collaboration; returns the pool wrapping the old process.
   * The content's pool membership is refreshed.
   */
  private followRoot(): string | undefined {
    const root = layoutRoot(this.doc.definitions);
    const rootId = idOf(root);
    if (!root || !rootId || rootId === this.snap.rootId || !is(root, 'bpmn:Collaboration')) {
      return undefined;
    }
    const old = this.planes.find((plane) => plane.rootId === this.snap.rootId);
    if (!old || this.planes.some((plane) => plane.rootId === rootId)) {
      return undefined;
    }
    old.root = root;
    old.rootId = rootId;
    const wrapper = rawList(root, 'participants').find((participant) => idOf(raw(participant, 'processRef')) === this.snap.rootId);
    const poolId = idOf(wrapper);
    if (poolId) {
      for (const shape of old.shapes.values()) {
        if (!shape.poolId && shape.kind !== 'participant') shape.poolId = poolId;
      }
    }
    return poolId;
  }

  /**
   * Draws new pools and lanes; the engine lays the content of a new pool's process out as one
   * block.
   */
  private async placeContainers(wrapped: string | undefined): Promise<void> {
    const shapes = this.shapeIndex(this.planes);
    for (const el of this.modelOrder(this.doc.definitions)) {
      const id = idOf(el);
      if (!id || shapes.has(id)) continue;
      if (is(el, 'bpmn:Participant')) {
        const plane = this.sem.homePlane(this.planes, id);
        if (!plane) continue;
        const shape = this.place.newShape(plane, id, { x: 0, y: 0, width: 0, height: 0 });
        const proc = raw<El>(el, 'processRef');
        const content = id !== wrapped && proc ? rawList(proc, 'flowElements').filter(this.isFlowNode) : [];
        const block = content.length ? (await this.engineDrawing()).block(id, true) : undefined;
        if (id === wrapped) {
          this.drawing(plane).wrapPool(shape);
        } else {
          this.drawing(plane).placePool(shape, !proc, block ? { width: block.box.width, height: block.box.height } : undefined);
        }
        plane.shapes.set(id, shape);
        if (block) {
          this.adoptBlock(plane, block, shape.bounds.x - block.box.x, shape.bounds.y - block.box.y);
        }
        this.place.placed.add(id);
        shapes.set(id, { plane, shape });
      } else if (is(el, 'bpmn:Lane')) {
        const plane = this.sem.homePlane(this.planes, id);
        if (!plane) continue;
        const shape = this.place.newShape(plane, id, { x: 0, y: 0, width: 0, height: 0 });
        if (!this.drawing(plane).placeLane(shape)) {
          this.notes.push(`lane ${id} not drawn: its process has no pool in the diagram`);
          continue;
        }
        plane.shapes.set(id, shape);
        this.place.placed.add(id);
        shapes.set(id, { plane, shape });
      }
    }
  }

  /**
   * New flow nodes and artifacts in op order; new expanded sub-processes with content (and
   * collapsed ones whose content has no DI) come from the engine as one block.
   * Op order comes first because the model lists an inserted node next to its anchor; model order
   * breaks ties.
   */
  private async placeNodes(): Promise<void> {
    const drawn = (id: string): boolean => this.planes.some((plane) => plane.shapes.has(id));
    const order = this.modelOrder(this.doc.definitions);
    const rank = new Map(this.created.map((id, index) => [id, index]));
    const pendingNodes = order
      .filter((el) => this.isFlowNode(el) && idOf(el) && !drawn(idOf(el)!))
      .map((el) => idOf(el)!)
      .map((id, index) => ({ id, key: rank.get(id) ?? this.created.length + index }))
      .sort((first, second) => first.key - second.key)
      .map((entry) => entry.id);
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
        for (const shape of block.shapes) {
          inBlock.add(shape.id);
        }
        for (const blockPlane of block.planes) {
          for (const shape of blockPlane.shapes.values()) {
            inBlock.add(shape.id);
          }
        }
        blocksByRoot.set(root, block);
      }
    }
    for (const id of pendingNodes) {
      const scope = this.sem.scopeOf.get(id);
      const sid = idOf(scope);
      if (!scope || !sid || !Semantics.isSubProcess(scope) || inBlock.has(id) || this.planes.some((plane) => plane.rootId === sid)) {
        continue;
      }
      const shape = this.planes.map((plane) => plane.shapes.get(sid)).find((candidate) => !!candidate);
      if (shape ? shape.expanded : !this.place.collapsed.has(sid)) continue;
      if (rawList(scope, 'flowElements').some((fe) => this.isFlowNode(fe) && drawn(idOf(fe) ?? ''))) {
        continue;
      }
      const enginePlane = (await this.engineDrawing()).planes.find((plane) => plane.rootId === sid);
      if (!enginePlane) continue;
      this.adoptBlock(this.planes[0]!, { box: { x: 0, y: 0, width: 0, height: 0 }, shapes: [], edges: [], planes: [enginePlane] }, 0, 0);
      for (const shape of enginePlane.shapes.values()) {
        inBlock.add(shape.id);
      }
    }
    this.afterPlace = (plane: Plane, shape: DShape): void => {
      const block = blocksByRoot.get(shape.id);
      if (block) {
        this.adoptBlock(plane, block, shape.bounds.x - block.box.x, shape.bounds.y - block.box.y);
      }
    };
    this.afterNode = (plane: Plane, id: string): void => this.routing.routeNow(plane, id);
    const skipped = this.place.placeFlowNodes(
      pendingNodes.filter((id) => !inBlock.has(id)),
    );
    delete this.afterPlace;
    delete this.afterNode;
    for (const id of skipped) {
      this.notes.push(`${id} not drawn: it belongs to no diagram`);
    }
    for (const el of order) {
      const id = idOf(el);
      if (!id || !this.isArtifactShape(el) || drawn(id) || inBlock.has(id)) continue;
      if (!this.place.placeArtifact(id)) {
        this.notes.push(`${id} not drawn: it belongs to no diagram`);
      }
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
      for (const shape of plane.shapes.values()) {
        if (!shape.di || (this.place.placed.has(shape.id) && !this.relocated.has(shape.id))) {
          continue;
        }
        const old = this.snap.byDi.get(shape.di);
        if (old?.bounds && !sameBox(old.bounds, shape.bounds)) out.push(shape.id);
      }
    }
    for (const id of this.relocated) {
      if (!out.includes(id)) out.push(id);
    }
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
      if (touched.length) {
        throw new Error(`${vertical.kind === 'lane' ? 'lane' : 'pool'} ${vertical.id} is drawn vertically (isHorizontal=false); the incremental layout only edits horizontal pools and lanes (it would have changed ${touched.slice(0, 3).join(', ')})`);
      }
    }
  }
}
