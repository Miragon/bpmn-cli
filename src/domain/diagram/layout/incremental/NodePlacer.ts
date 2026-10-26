import { LayoutDebug } from '../LayoutDebug.js';
import { annotationSize, SIZES } from '../../utils/sizes.js';
import { is, type El } from '../../../document/utils/moddle.js';
import { bottom, clamp, cx, cy, median, right, type Box } from '../../utils/geom.js';
import { defaultLabelSide, hasExternalLabel, labelAt } from '../../utils/labels.js';
import { idOf, raw } from '../../utils/raw.js';
import { DiagramReader } from '../../di/DiagramReader.js';
import { Frames } from '../../di/Frames.js';
import { PlaneQuery, type Spacing } from '../../di/PlaneQuery.js';
import { Semantics } from '../../di/Semantics.js';

import type { DEdge, DShape, Plane, ShapeKind } from '../../di/types.js';
import { Drawing } from './Drawing.js';
import { labelSize } from '../../utils/text.js';
import { PlacementObstacles } from './PlacementObstacles.js';
import { RowChooser } from './RowChooser.js';
import { BoundaryPlacer } from './BoundaryPlacer.js';
import { NeighbourPlacer } from './NeighbourPlacer.js';
import { ArtifactPlacer } from './ArtifactPlacer.js';

export interface Reuse {
  shape: DShape;
  boundaries: DShape[];
  /** plane the node was drawn on */
  from: Plane;
  /** content of an expanded sub-process (moves rigidly with it) */
  content?: { shapes: DShape[]; edges: DEdge[] };
}

export interface PlacementHooks {
  /** resolves the plane an element belongs on (creating it when needed) */
  planeFor(id: string): Plane | undefined;
  /** called after a shape was placed (blocks add their content here) */
  afterPlace?(plane: Plane, shape: DShape): void;
  /**
   * called after placeFlowNodes placed a node when more nodes follow: its flows to drawn nodes
   * are routed right away, so the next placement sees them like the next single command would
   */
  afterNode?(plane: Plane, id: string): void;
}

/** What a placement run changes in its placer, to undo it. */
export interface PlacerState {
  placed: Set<string>;
  moved: Set<string>;
  spacing: Map<Plane, Spacing>;
  reuse: Map<string, Reuse>;
  blockSize: Map<string, { width: number; height: number }>;
  spliced?: Map<string, string>;
  joins?: Map<string, string>;
  relabel?: Set<string>;
  heads?: Map<string, number>;
  skip?: Map<string, number>;
  continued?: Set<string>;
}

export interface Probe {
  id: string;
  kind: DShape['kind'];
  parentId?: string;
  laneId?: string;
  poolId?: string;
}

/**
 * Places elements without DI into a kept drawing, like single commands would: flow nodes in op
 * order next to their placed neighbours, boundary events on their hosts, artifacts by what they
 * belong to. Holds the run's state, which the local repair checkpoints and restores.
 */
export class NodePlacer {
  /** the drawing's gap and row spacing per plane (measured again while a batch places its nodes) */
  readonly spacing: Map<Plane, Spacing>;
  /** ids that got a new shape in this run */
  readonly placed = new Set<string>();
  /** pre-existing shapes moved in this run */
  readonly moved = new Set<string>();
  /** shapes of relocated nodes (their DI is reused), their boundary events and expanded content */
  readonly reuse = new Map<string, Reuse>();
  /** fixed sizes for blocks laid out elsewhere (new expanded sub-processes, pools) */
  readonly blockSize = new Map<string, { width: number; height: number }>();
  /** nodes spliced in this run: the successor they were spliced before (a chain continues it) */
  spliced?: Map<string, string>;
  /** joins placed again right of their rightmost predecessor, before this successor */
  joins?: Map<string, string>;
  /** shapes whose label is placed again at the end (a boundary event moved to the top border) */
  relabel?: Set<string>;
  /** heads of branches and exception paths placed in this run: their number of row candidates */
  heads?: Map<string, number>;
  /** the local repair's request: start this head at its n-th cheapest candidate (0: cheapest) */
  skip?: Map<string, number>;
  /** nodes continuing a chain on their anchor's row: a line touching them is rerouted */
  continued?: Set<string>;
  private readonly drawings = new Map<Plane, Drawing>();
  private readonly rows: RowChooser;
  private readonly boundaries: BoundaryPlacer;
  private readonly neighbours: NeighbourPlacer;
  private readonly artifacts: ArtifactPlacer;

  constructor(
    private readonly planes: Plane[],
    readonly sem: Semantics,
    /** sequence flows whose source / target changed: their ids before the ops */
    readonly oldSource: ReadonlyMap<string, string>,
    readonly oldTarget: ReadonlyMap<string, string>,
    /** new sub-processes drawn collapsed (all others are expanded) */
    readonly collapsed: ReadonlySet<string>,
    readonly notes: string[],
    private readonly hooks: PlacementHooks,
  ) {
    this.spacing = new Map(planes.map((plane) => [plane, PlaneQuery.spacingOf(plane)]));
    const obstacles = new PlacementObstacles(this);
    this.rows = new RowChooser(this, obstacles);
    this.boundaries = new BoundaryPlacer(this, obstacles, this.rows);
    this.neighbours = new NeighbourPlacer(this, obstacles, this.rows, this.boundaries);
    this.artifacts = new ArtifactPlacer(this, obstacles, this.neighbours);
  }

  checkpoint(): PlacerState {
    return {
      placed: new Set(this.placed),
      moved: new Set(this.moved),
      spacing: new Map(this.spacing),
      reuse: new Map(this.reuse),
      blockSize: new Map(this.blockSize),
      ...(this.spliced ? { spliced: new Map(this.spliced) } : {}),
      ...(this.joins ? { joins: new Map(this.joins) } : {}),
      ...(this.relabel ? { relabel: new Set(this.relabel) } : {}),
      ...(this.continued ? { continued: new Set(this.continued) } : {}),
      ...(this.heads ? { heads: new Map(this.heads) } : {}),
      ...(this.skip ? { skip: new Map(this.skip) } : {}),
    };
  }

  restore(st: PlacerState): void {
    const refill = <TElement>(into: Set<TElement>, from: Set<TElement>): void => {
      into.clear();
      for (const element of from) into.add(element);
    };
    const remap = <TKey, TValue>(into: Map<TKey, TValue>, from: Map<TKey, TValue>): void => {
      into.clear();
      for (const [key, entry] of from) into.set(key, entry);
    };
    refill(this.placed, st.placed);
    refill(this.moved, st.moved);
    remap(this.spacing, st.spacing);
    remap(this.reuse, st.reuse);
    remap(this.blockSize, st.blockSize);
    this.spliced = st.spliced && new Map(st.spliced);
    this.joins = st.joins && new Map(st.joins);
    this.heads = st.heads && new Map(st.heads);
    this.skip = st.skip && new Map(st.skip);
    this.relabel = st.relabel && new Set(st.relabel);
    this.continued = st.continued && new Set(st.continued);
  }

  drawing(plane: Plane): Drawing {
    let drawing = this.drawings.get(plane);
    if (!drawing) this.drawings.set(plane, (drawing = new Drawing(plane)));
    return drawing;
  }

  spacingFor(plane: Plane): Spacing {
    let spacing = this.spacing.get(plane);
    if (!spacing) {
      spacing = PlaneQuery.spacingOf(plane);
      this.spacing.set(plane, spacing);
    }
    return spacing;
  }

  private defaultSize(el: El): { width: number; height: number } {
    if (is(el, 'bpmn:Event')) return { ...SIZES.event };
    if (is(el, 'bpmn:Gateway')) return { ...SIZES.gateway };
    if (is(el, 'bpmn:DataObjectReference')) return { ...SIZES.dataObject };
    if (is(el, 'bpmn:DataStoreReference')) return { ...SIZES.dataStore };
    if (is(el, 'bpmn:TextAnnotation')) return annotationSize(raw<string>(el, 'text'));
    return { ...SIZES.task };
  }

  /** Size of a new shape: the median of its kind on the plane, else the engine default. */
  sizeFor(plane: Plane, id: string): { width: number; height: number } {
    const block = this.blockSize.get(id);
    if (block) return block;
    // a relocated node keeps its size (an expanded sub-process its content too)
    const reused = this.reuse.get(id)?.shape.bounds;
    if (reused) return { width: reused.width, height: reused.height };
    const el = this.sem.byId.get(id)!;
    const kind = DiagramReader.shapeKind(el);
    if (kind === 'subProcess' && this.expandedByDefault(id)) return { width: 350, height: 200 };
    if (kind === 'annotation') return this.defaultSize(el);
    // events and boundary events share a size, so do tasks and collapsed sub-processes
    const family = (shapeKind: ShapeKind): string => (shapeKind === 'boundary' ? 'event' : shapeKind === 'subProcess' ? 'task' : shapeKind);
    const sameKind = (shape: DShape): boolean => !shape.container && family(shape.kind) === family(kind) && (kind !== 'data' || shape.el.$type === el.$type);
    const peers = [...plane.shapes.values()].filter(sameKind);
    const medianWidth = median(peers.map((shape) => shape.bounds.width));
    const medianHeight = median(peers.map((shape) => shape.bounds.height));
    const fallback = this.defaultSize(el);
    if (medianWidth === undefined || medianHeight === undefined) return fallback;
    // stay within a sensible range of the default (hand drawings may contain one huge task)
    return { width: Math.round(clamp(medianWidth, fallback.width * 0.6, fallback.width * 1.6)), height: Math.round(clamp(medianHeight, fallback.height * 0.6, fallback.height * 1.6)) };
  }

  /** New sub-processes are expanded unless a collapse was requested. */
  private expandedByDefault(id: string): boolean {
    return !this.collapsed.has(id);
  }

  /** Creates the DShape of a new element (membership from the semantic model). */
  newShape(plane: Plane, id: string, bounds: Box): DShape {
    const reuse = this.reuse.get(id);
    const el = this.sem.byId.get(id)!;
    const kind = DiagramReader.shapeKind(el);
    const expanded = kind === 'subProcess' ? (reuse ? reuse.shape.expanded === true : this.expandedByDefault(id) || this.blockSize.has(id)) : undefined;
    const shape: DShape = { id, el, bounds, kind, container: kind === 'participant' || kind === 'lane' || (kind === 'subProcess' && expanded === true) };
    if (reuse?.shape.di) shape.di = reuse.shape.di;
    // a BPMNShape without valid bounds gets its bounds now (one DI per element, its colours kept)
    else if (!reuse) {
      const di = this.planes.map((candidate) => candidate.unbounded?.get(id)).find((unbounded) => !!unbounded);
      if (di) shape.di = di;
    }
    if (expanded !== undefined) shape.expanded = expanded;
    if (kind === 'boundary') {
      const host = idOf(raw(el, 'attachedToRef'));
      if (host) shape.hostId = host;
    }
    const lane = kind === 'lane' ? this.sem.laneParent.get(id) : this.sem.laneOf.get(id);
    if (lane) shape.laneId = lane;
    const pool = this.sem.poolOf(id);
    if (pool) shape.poolId = pool;
    const scope = this.sem.scopeOf.get(id);
    const sid = idOf(scope);
    if (scope && sid && Semantics.isSubProcess(scope) && plane.shapes.get(sid)?.expanded) shape.parentId = sid;
    if (reuse?.shape.label) {
      const old = reuse.shape.bounds;
      shape.label = { ...reuse.shape.label, x: reuse.shape.label.x + bounds.x - old.x, y: reuse.shape.label.y + bounds.y - old.y };
    }
    return shape;
  }

  /** Adds a placed shape to the plane with its reused boundary events, fitted into its frame. */
  commit(plane: Plane, shape: DShape): void {
    // never above / left of the frame's interior (fitInFrame only grows a frame right and down)
    const frame = shape.kind === 'boundary' ? undefined : Frames.of(plane, shape);
    if (frame) {
      const inner = Frames.interior(frame, 15);
      const dx = Math.max(0, Math.round(inner.x - shape.bounds.x));
      const dy = Math.max(0, Math.round(inner.y - shape.bounds.y));
      if (dx || dy) {
        shape.bounds.x += dx;
        shape.bounds.y += dy;
        if (shape.label) {
          shape.label.x += dx;
          shape.label.y += dy;
        }
      }
    }
    plane.shapes.set(shape.id, shape);
    this.placed.add(shape.id);
    const reuse = this.reuse.get(shape.id);
    if (reuse) {
      const old = reuse.shape.bounds;
      const dx = shape.bounds.x - old.x;
      const dy = shape.bounds.y - old.y;
      const translate = (moving: DShape): void => {
        moving.bounds.x += dx;
        moving.bounds.y += dy;
        if (moving.label) {
          moving.label.x += dx;
          moving.label.y += dy;
        }
        plane.shapes.set(moving.id, moving);
        this.moved.add(moving.id);
      };
      reuse.boundaries.forEach(translate);
      for (const child of reuse.content?.shapes ?? []) translate(child);
      for (const edge of reuse.content?.edges ?? []) {
        for (const point of edge.points) {
          point.x += dx;
          point.y += dy;
        }
        if (edge.label) {
          edge.label.x += dx;
          edge.label.y += dy;
        }
        if (reuse.from !== plane) {
          reuse.from.edges.delete(edge.id);
          plane.edges.set(edge.id, edge);
        }
      }
      this.reuse.delete(shape.id);
    }
    this.hooks.afterPlace?.(plane, shape);
    const fitted = this.drawing(plane).fitInFrame(shape.id, 15);
    fitted.moved.forEach((movedId) => this.moved.add(movedId));
    // the label a new gateway gets above it: room below the title of its sub-process
    const name = raw<string>(shape.el, 'name')?.trim();
    if (!reuse && name && frame?.kind === 'subProcess' && hasExternalLabel(shape) && shape.kind !== 'boundary' && defaultLabelSide(shape.kind) === 'above') {
      const { width, height } = labelSize(name);
      const room = this.drawing(plane).roomBelowTitle(frame, labelAt(shape, { width, height }, 'above'), shape.id);
      if (room) this.recordSpace(room.res);
    }
    if (!reuse && shape.kind !== 'boundary') this.boundaries.reattachBoundaries(plane, shape);
  }

  recordSpace(result: { moved: Set<string> }): void {
    result.moved.forEach((movedId) => this.moved.add(movedId));
  }

  /** Moves an existing node into its (new) lane: same x, a free row of the lane band. */
  changeLane(plane: Plane, id: string): boolean {
    const shape = plane.shapes.get(id);
    const lane = shape?.laneId ? plane.shapes.get(shape.laneId) : undefined;
    if (!shape || !lane) return false;
    const inner = Frames.interior(lane, 2);
    const inLane = (): boolean => shape.bounds.y >= inner.y && bottom(shape.bounds) <= bottom(inner) && shape.bounds.x >= lane.bounds.x && right(shape.bounds) <= right(lane.bounds);
    if (inLane()) return false;
    const exclude = new Set([id, ...PlaneQuery.boundariesOf(plane, id).map((boundary) => boundary.id)]);
    const neighbours = [...this.sem.predecessors(id), ...this.sem.successors(id)]
      .map((neighbour) => plane.shapes.get(neighbour))
      .filter((neighbour): neighbour is DShape => !!neighbour && neighbour.laneId === lane.id)
      .map((neighbour) => Math.round(cy(neighbour.bounds)));
    const centre = this.rows.rowInLane(plane, lane, shape.bounds.x, shape.bounds.width, shape.bounds.height, neighbours, exclude);
    const dy = Math.round(centre - shape.bounds.height / 2 - shape.bounds.y);
    for (const movedId of this.drawing(plane).shift(id, 0, dy)) this.moved.add(movedId);
    // a row of the lane's own (as close to the border as its shapes sit) needs no growth
    if (!inLane()) this.recordSpace(this.drawing(plane).fitInFrame(id, 15));
    return true;
  }

  probeOf(plane: Plane, id: string): Probe {
    const shape = this.newShape(plane, id, { x: 0, y: 0, width: 0, height: 0 });
    return { id, kind: shape.kind, ...(shape.parentId ? { parentId: shape.parentId } : {}), ...(shape.laneId ? { laneId: shape.laneId } : {}), ...(shape.poolId ? { poolId: shape.poolId } : {}) };
  }

  placeAt(plane: Plane, id: string, left: number, centreY: number, size: { width: number; height: number }): DShape {
    const shape = this.newShape(plane, id, { x: Math.round(left), y: Math.round(centreY - size.height / 2), ...size });
    this.commit(plane, shape);
    return shape;
  }

  /** Whether `to` follows `from` along sequence flows (at most 500 nodes visited). */
  private leadsTo(from: string, to: string): boolean {
    const seen = new Set([from]);
    const queue = [from];
    while (queue.length && seen.size <= 500) {
      for (const successor of this.sem.successors(queue.shift()!)) {
        if (successor === to) return true;
        if (seen.has(successor)) continue;
        seen.add(successor);
        queue.push(successor);
      }
    }
    return false;
  }

  /**
   * A join placed in this run whose last predecessor `id` was just placed, and that a flow from a
   * predecessor would now enter backwards (no loop return), is placed again right of its rightmost
   * predecessor, before its one successor S: what the `connect` into it does as a single command.
   */
  private pullPlacedJoins(plane: Plane, id: string, pending: ReadonlySet<string>): void {
    for (const jid of this.sem.successors(id)) {
      const join = plane.shapes.get(jid);
      if (!join || !this.placed.has(jid) || pending.has(jid) || !is(join.el, 'bpmn:Gateway')) continue;
      const preds = this.sem.predecessors(jid).map((predId) => plane.shapes.get(predId));
      const outs = this.sem.successors(jid);
      const successor = outs.length === 1 ? plane.shapes.get(outs[0]!) : undefined;
      if (preds.length < 2 || !successor || !preds.every((pred): pred is DShape => !!pred)) continue;
      const sameFrame = (shape: DShape): boolean => shape.poolId === join.poolId && shape.parentId === join.parentId;
      if (!preds.every(sameFrame) || !sameFrame(successor) || successor.bounds.x <= Math.max(...preds.map((pred) => right(pred.bounds)))) continue;
      if (!preds.some((pred) => cx(join.bounds) < pred.bounds.x && !this.leadsTo(jid, pred.id))) continue;
      plane.shapes.delete(jid);
      (this.joins ??= new Map()).set(jid, successor.id);
      if (LayoutDebug.on()) LayoutDebug.log(`[join] ${jid}: a flow from ${preds.map((pred) => pred.id).join(', ')} would enter it backwards: placed again before ${successor.id}`);
      this.neighbours.placeAfter(plane, jid, preds, pending);
    }
  }

  /**
   * Gives every flow node in `ids` a shape, in op order as far as their neighbours allow: the
   * normal flow, boundary events, their exception paths, nodes before a placed successor, the
   * rest. Ids whose plane does not exist are skipped and returned.
   */
  placeFlowNodes(ids: string[]): string[] {
    const pending = new Set(ids);
    const skipped: string[] = [];
    const shapeOn = (plane: Plane, id: string): DShape | undefined => plane.shapes.get(id);
    /**
     * exception paths (the new nodes after a new boundary event) wait for the normal flow's new
     * nodes, like single commands that add the normal flow first: the two do not cross
     */
    const exception = new Set<string>();
    const walk = ids.filter((id) => is(this.sem.byId.get(id), 'bpmn:BoundaryEvent'));
    while (walk.length) {
      for (const successor of this.sem.successors(walk.shift()!)) {
        if (!pending.has(successor) || exception.has(successor)) continue;
        exception.add(successor);
        walk.push(successor);
      }
    }
    let last: { plane: Plane; id: string } | undefined;
    while (pending.size) {
      // a relocated node brings its boundary events and content along (commit): never placed twice
      for (const id of pending) if (this.planes.some((candidate) => candidate.shapes.has(id))) pending.delete(id);
      if (!pending.size) break;
      // more nodes follow: the one placed last gets its flows now, so the next placement sees them
      if (last) this.hooks.afterNode?.(last.plane, last.id);
      last = undefined;
      let chosen: { id: string; plane: Plane; mode: 'boundary' | 'after' | 'exception' | 'before' | 'free'; preds?: DShape[]; succ?: DShape } | undefined;
      for (const mode of ['after', 'boundary', 'exception', 'before', 'free'] as const) {
        for (const id of pending) {
          const plane = this.hooks.planeFor(id);
          if (!plane) continue;
          const el = this.sem.byId.get(id)!;
          if (mode === 'boundary') {
            if (!is(el, 'bpmn:BoundaryEvent')) continue;
            const host = idOf(raw(el, 'attachedToRef'));
            if (host && shapeOn(plane, host)) chosen = { id, plane, mode };
          } else if (is(el, 'bpmn:BoundaryEvent') && idOf(raw(el, 'attachedToRef')) && pending.has(idOf(raw(el, 'attachedToRef'))!)) {
            continue;
          } else if (mode === 'after' || mode === 'exception') {
            if (is(el, 'bpmn:BoundaryEvent') || exception.has(id) !== (mode === 'exception')) continue;
            const preds = this.sem.predecessors(id).map((predId) => shapeOn(plane, predId)).filter((pred): pred is DShape => !!pred);
            if (preds.length) chosen = { id, plane, mode, preds };
          } else if (mode === 'before') {
            const succ = this.sem.successors(id).map((succId) => shapeOn(plane, succId)).find((shape): shape is DShape => !!shape);
            if (succ) chosen = { id, plane, mode, succ };
          } else chosen = { id, plane, mode };
          if (chosen) break;
        }
        if (chosen) break;
      }
      if (!chosen) {
        for (const id of pending) skipped.push(id);
        break;
      }
      pending.delete(chosen.id);
      if (chosen.mode === 'boundary') {
        if (!this.boundaries.placeBoundary(chosen.plane, chosen.id)) this.neighbours.placeUnconnected(chosen.plane, chosen.id);
      } else if (chosen.mode === 'after' || chosen.mode === 'exception') this.neighbours.placeAfter(chosen.plane, chosen.id, chosen.preds!, pending);
      else if (chosen.mode === 'before') this.neighbours.placeBefore(chosen.plane, chosen.id, chosen.succ!);
      else if (is(this.sem.byId.get(chosen.id)!, 'bpmn:BoundaryEvent') && this.boundaries.placeBoundary(chosen.plane, chosen.id)) {
        /* host placed meanwhile */
      } else this.neighbours.placeUnconnected(chosen.plane, chosen.id);
      this.pullPlacedJoins(chosen.plane, chosen.id, pending);
      last = { plane: chosen.plane, id: chosen.id };
    }
    return skipped;
  }

  /** Text annotation above-right, data object / store below-right of the element it belongs to. */
  placeArtifact(id: string): boolean {
    const plane = this.hooks.planeFor(id);
    if (!plane) return false;
    this.artifacts.placeArtifact(plane, id);
    return true;
  }
}
