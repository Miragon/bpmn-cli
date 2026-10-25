import { LayoutDebug } from '../LayoutDebug.js';
import { annotationSize, SIZES } from '../../drawing/utils/sizes.js';
import { is, type El } from '../../model/utils/moddle.js';
import { bottom, clamp, cx, cy, median, right, type Box } from '../../drawing/utils/geom.js';
import { defaultLabelSide, hasExternalLabel, labelAt } from '../../drawing/utils/labels.js';
import { idOf, raw } from '../../drawing/utils/raw.js';
import { DiagramReader } from '../../drawing/DiagramReader.js';
import { Frames } from '../../drawing/Frames.js';
import { PlaneQuery, type Spacing } from '../../drawing/PlaneQuery.js';
import { Semantics } from '../../drawing/Semantics.js';

import type { DEdge, DShape, Plane, ShapeKind } from '../../drawing/types.js';
import { Drawing } from './Drawing.js';
import { labelSize } from '../../drawing/utils/text.js';
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
  afterPlace?(plane: Plane, s: DShape): void;
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
    this.spacing = new Map(planes.map((p) => [p, PlaneQuery.spacingOf(p)]));
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
    const refill = <T>(into: Set<T>, from: Set<T>): void => {
      into.clear();
      for (const x of from) into.add(x);
    };
    const remap = <K, V>(into: Map<K, V>, from: Map<K, V>): void => {
      into.clear();
      for (const [k, v] of from) into.set(k, v);
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
    let d = this.drawings.get(plane);
    if (!d) this.drawings.set(plane, (d = new Drawing(plane)));
    return d;
  }

  spacingFor(plane: Plane): Spacing {
    let s = this.spacing.get(plane);
    if (!s) {
      s = PlaneQuery.spacingOf(plane);
      this.spacing.set(plane, s);
    }
    return s;
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
    const family = (k: ShapeKind): string => (k === 'boundary' ? 'event' : k === 'subProcess' ? 'task' : k);
    const sameKind = (s: DShape): boolean => !s.container && family(s.kind) === family(kind) && (kind !== 'data' || s.el.$type === el.$type);
    const peers = [...plane.shapes.values()].filter(sameKind);
    const w = median(peers.map((s) => s.bounds.width));
    const h = median(peers.map((s) => s.bounds.height));
    const d = this.defaultSize(el);
    if (w === undefined || h === undefined) return d;
    // stay within a sensible range of the default (hand drawings may contain one huge task)
    return { width: Math.round(clamp(w, d.width * 0.6, d.width * 1.6)), height: Math.round(clamp(h, d.height * 0.6, d.height * 1.6)) };
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
    const s: DShape = { id, el, bounds, kind, container: kind === 'participant' || kind === 'lane' || (kind === 'subProcess' && expanded === true) };
    if (reuse?.shape.di) s.di = reuse.shape.di;
    // a BPMNShape without valid bounds gets its bounds now (one DI per element, its colours kept)
    else if (!reuse) {
      const di = this.planes.map((p) => p.unbounded?.get(id)).find((x) => !!x);
      if (di) s.di = di;
    }
    if (expanded !== undefined) s.expanded = expanded;
    if (kind === 'boundary') {
      const host = idOf(raw(el, 'attachedToRef'));
      if (host) s.hostId = host;
    }
    const lane = kind === 'lane' ? this.sem.laneParent.get(id) : this.sem.laneOf.get(id);
    if (lane) s.laneId = lane;
    const pool = this.sem.poolOf(id);
    if (pool) s.poolId = pool;
    const scope = this.sem.scopeOf.get(id);
    const sid = idOf(scope);
    if (scope && sid && Semantics.isSubProcess(scope) && plane.shapes.get(sid)?.expanded) s.parentId = sid;
    if (reuse?.shape.label) {
      const old = reuse.shape.bounds;
      s.label = { ...reuse.shape.label, x: reuse.shape.label.x + bounds.x - old.x, y: reuse.shape.label.y + bounds.y - old.y };
    }
    return s;
  }

  /** Adds a placed shape to the plane with its reused boundary events, fitted into its frame. */
  commit(plane: Plane, s: DShape): void {
    // never above / left of the frame's interior (fitInFrame only grows a frame right and down)
    const frame = s.kind === 'boundary' ? undefined : Frames.of(plane, s);
    if (frame) {
      const inner = Frames.interior(frame, 15);
      const dx = Math.max(0, Math.round(inner.x - s.bounds.x));
      const dy = Math.max(0, Math.round(inner.y - s.bounds.y));
      if (dx || dy) {
        s.bounds.x += dx;
        s.bounds.y += dy;
        if (s.label) {
          s.label.x += dx;
          s.label.y += dy;
        }
      }
    }
    plane.shapes.set(s.id, s);
    this.placed.add(s.id);
    const reuse = this.reuse.get(s.id);
    if (reuse) {
      const old = reuse.shape.bounds;
      const dx = s.bounds.x - old.x;
      const dy = s.bounds.y - old.y;
      const translate = (b: DShape): void => {
        b.bounds.x += dx;
        b.bounds.y += dy;
        if (b.label) {
          b.label.x += dx;
          b.label.y += dy;
        }
        plane.shapes.set(b.id, b);
        this.moved.add(b.id);
      };
      reuse.boundaries.forEach(translate);
      for (const c of reuse.content?.shapes ?? []) translate(c);
      for (const e of reuse.content?.edges ?? []) {
        for (const p of e.points) {
          p.x += dx;
          p.y += dy;
        }
        if (e.label) {
          e.label.x += dx;
          e.label.y += dy;
        }
        if (reuse.from !== plane) {
          reuse.from.edges.delete(e.id);
          plane.edges.set(e.id, e);
        }
      }
      this.reuse.delete(s.id);
    }
    this.hooks.afterPlace?.(plane, s);
    const r = this.drawing(plane).fitInFrame(s.id, 15);
    r.moved.forEach((x) => this.moved.add(x));
    // the label a new gateway gets above it: room below the title of its sub-process
    const name = raw<string>(s.el, 'name')?.trim();
    if (!reuse && name && frame?.kind === 'subProcess' && hasExternalLabel(s) && s.kind !== 'boundary' && defaultLabelSide(s.kind) === 'above') {
      const { width, height } = labelSize(name);
      const room = this.drawing(plane).roomBelowTitle(frame, labelAt(s, { width, height }, 'above'), s.id);
      if (room) this.recordSpace(room.res);
    }
    if (!reuse && s.kind !== 'boundary') this.boundaries.reattachBoundaries(plane, s);
  }

  recordSpace(r: { moved: Set<string> }): void {
    r.moved.forEach((x) => this.moved.add(x));
  }

  /** Moves an existing node into its (new) lane: same x, a free row of the lane band. */
  changeLane(plane: Plane, id: string): boolean {
    const s = plane.shapes.get(id);
    const lane = s?.laneId ? plane.shapes.get(s.laneId) : undefined;
    if (!s || !lane) return false;
    const inner = Frames.interior(lane, 2);
    const inLane = (): boolean => s.bounds.y >= inner.y && bottom(s.bounds) <= bottom(inner) && s.bounds.x >= lane.bounds.x && right(s.bounds) <= right(lane.bounds);
    if (inLane()) return false;
    const exclude = new Set([id, ...PlaneQuery.boundariesOf(plane, id).map((b) => b.id)]);
    const neighbours = [...this.sem.predecessors(id), ...this.sem.successors(id)]
      .map((n) => plane.shapes.get(n))
      .filter((n): n is DShape => !!n && n.laneId === lane.id)
      .map((n) => Math.round(cy(n.bounds)));
    const c = this.rows.rowInLane(plane, lane, s.bounds.x, s.bounds.width, s.bounds.height, neighbours, exclude);
    const dy = Math.round(c - s.bounds.height / 2 - s.bounds.y);
    for (const m of this.drawing(plane).shift(id, 0, dy)) this.moved.add(m);
    // a row of the lane's own (as close to the border as its shapes sit) needs no growth
    if (!inLane()) this.recordSpace(this.drawing(plane).fitInFrame(id, 15));
    return true;
  }

  probeOf(plane: Plane, id: string): Probe {
    const s = this.newShape(plane, id, { x: 0, y: 0, width: 0, height: 0 });
    return { id, kind: s.kind, ...(s.parentId ? { parentId: s.parentId } : {}), ...(s.laneId ? { laneId: s.laneId } : {}), ...(s.poolId ? { poolId: s.poolId } : {}) };
  }

  placeAt(plane: Plane, id: string, x: number, centreY: number, size: { width: number; height: number }): DShape {
    const s = this.newShape(plane, id, { x: Math.round(x), y: Math.round(centreY - size.height / 2), ...size });
    this.commit(plane, s);
    return s;
  }

  /** Whether `to` follows `from` along sequence flows (at most 500 nodes visited). */
  private leadsTo(from: string, to: string): boolean {
    const seen = new Set([from]);
    const queue = [from];
    while (queue.length && seen.size <= 500) {
      for (const n of this.sem.successors(queue.shift()!)) {
        if (n === to) return true;
        if (seen.has(n)) continue;
        seen.add(n);
        queue.push(n);
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
      const preds = this.sem.predecessors(jid).map((p) => plane.shapes.get(p));
      const outs = this.sem.successors(jid);
      const S = outs.length === 1 ? plane.shapes.get(outs[0]!) : undefined;
      if (preds.length < 2 || !S || !preds.every((p): p is DShape => !!p)) continue;
      const sameFrame = (s: DShape): boolean => s.poolId === join.poolId && s.parentId === join.parentId;
      if (!preds.every(sameFrame) || !sameFrame(S) || S.bounds.x <= Math.max(...preds.map((p) => right(p.bounds)))) continue;
      if (!preds.some((p) => cx(join.bounds) < p.bounds.x && !this.leadsTo(jid, p.id))) continue;
      plane.shapes.delete(jid);
      (this.joins ??= new Map()).set(jid, S.id);
      if (LayoutDebug.on()) LayoutDebug.log(`[join] ${jid}: a flow from ${preds.map((p) => p.id).join(', ')} would enter it backwards: placed again before ${S.id}`);
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
      for (const n of this.sem.successors(walk.shift()!)) {
        if (!pending.has(n) || exception.has(n)) continue;
        exception.add(n);
        walk.push(n);
      }
    }
    let last: { plane: Plane; id: string } | undefined;
    while (pending.size) {
      // a relocated node brings its boundary events and content along (commit): never placed twice
      for (const id of pending) if (this.planes.some((p) => p.shapes.has(id))) pending.delete(id);
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
            const preds = this.sem.predecessors(id).map((p) => shapeOn(plane, p)).filter((p): p is DShape => !!p);
            if (preds.length) chosen = { id, plane, mode, preds };
          } else if (mode === 'before') {
            const succ = this.sem.successors(id).map((p) => shapeOn(plane, p)).find((p): p is DShape => !!p);
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
