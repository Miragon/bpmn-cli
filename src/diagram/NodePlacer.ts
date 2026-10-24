/**
 * Placement of elements that have no DI yet, into a drawing that is kept.
 *
 * CONTRACT
 *  placeFlowNodes(ids) gives every flow node in `ids` a shape, in the
 *  order of `ids` (the order the ops created them) as far as their neighbours
 *  allow, like single commands: first the nodes with a placed predecessor
 *  (the normal flow), then boundary events whose host has a shape, then the
 *  exception paths (new nodes after a new boundary event: they wait for the
 *  normal flow's new nodes, so the two do not cross), then nodes with a
 *  placed successor, then the rest (chains of new nodes are placed one after
 *  the other). When more nodes follow, the afterNode hook gets the node just
 *  placed (layout/IncrementalLayout.ts routes its flows and measures the spacing again,
 *  as the next single command would see them). A join placed in this run
 *  that a flow from its last placed predecessor would enter backwards (no
 *  loop return) is placed again right of its predecessors, before its one
 *  successor, as the `connect` into it does as a single command
 *  (pullPlacedJoins; layout/IncrementalLayout.ts pullJoins for joins drawn before). The rules
 *  (gap = median horizontal gap between connected neighbours of the plane,
 *  clamped 40..100, fallback 60; row = median row spacing, clamped 80..150):
 *   - splice (the flow P->S was split by N; also N in a chain of new nodes
 *     after a node spliced before S in this run, when S still follows N
 *     through new nodes, branches included: a decision with a new "no"
 *     branch or a `split` in the chain keeps the splice; a join re-placed by
 *     layout/IncrementalLayout.ts pullJoins, before its successor): x = P.right + gap (more
 *     where P's label and N's on one side, below or above, would come closer
 *     than 4 px; the same between N and S), centred on
 *     S's row when S is in P's row band (or P is a branching node: another
 *     branch of P is drawn, or was drawn before the ops and leads to a node
 *     a later op of the batch spliced into it), else on P's row; S's row in
 *     another lane than N's own is replaced by a free row of N's lane
 *     (rowInLane: N's lane never stretches over to S's row);
 *     only when that spot is taken: space tool at P.right + 1 by
 *     N.width + gap within P's pool (inside an expanded sub-process: in
 *     frame mode, so the sub-process never grows over foreign shapes, see
 *     SpaceTool.ts; the same for every space-tool run placement makes there)
 *   - append, P has no other placed successor: continuation on P's row (space
 *     tool when something sits there); joins take the rightmost predecessor
 *   - append, P already has placed successors (new branch): column P.right +
 *     gap, a free row below P's existing branches in P's frame (lane, pool,
 *     sub-process); the frame grows when the row does not fit
 *   - prepend (only a successor S is placed): left of S, on S's row or the
 *     first free row below it; space tool right of S's predecessors otherwise
 *   - boundary event: on the host's bottom border, right-aligned, left of the
 *     host's existing boundary events (corner included, then the top border),
 *     preferring spots whose downward exit crosses no label; shapes right below
 *     are pushed down so the exception flow has room. Nodes after a boundary
 *     event go one column right of the host (or right below the event), one
 *     row below the host (or above it, see the row choice below)
 *   Branch and exception rows (issue #18 stage B) are chosen among
 *    · the first free rows below the anchor's branches (below the host for a
 *      boundary event's path);
 *    · the first of them opened with the space tool when it is taken by
 *      shapes or a line, or a line runs between the anchor and it: everything
 *      at or below the topmost thing in the way moves down, the horizontal
 *      segments of lines running under the anchor (bypass and loop-back
 *      lines) and the shapes they dock on included (linesUnder);
 *    · rows above the anchor, when it has no branch above it; for the first
 *      node of a boundary event's path that sits on the bottom border with
 *      no other path, rows above the host with the event moved to the host's
 *      top border (topCandidates); the first row above sticking out of the
 *      frame gets room at the top of the frame first;
 *   by a trial route from the anchor (connectionCost: cut shapes, crossings,
 *   labels hit, bends, length), the rest of the chain on the row (chainCost:
 *   lines crossing it, lines through the room it takes) and penalties for
 *   lower rows, rows on existing lines, the shapes a frame growth or opened
 *   row would move (an opened row costs less than one crossing) and rows
 *   above (TOP_ROW). A row also keeps room free of shapes for the new nodes
 *   that follow in a simple chain (labels and lines there are dealt with
 *   when they are placed); a node without any successor yet keeps room for
 *   one event (the next command mostly ends the branch there). The chosen
 *   head and its number of candidates are recorded (heads); the local
 *   repair (layout/IncrementalLayout.ts) can ask for the next cheapest one (skip).
 *   - unconnected: below the content of its frame (expanded sub-process, lane,
 *     pool or plane), left-aligned at the frame's first column; only the
 *     frame's own content counts (its members, what is drawn in it, the
 *     labels of its connections), never a label or group elsewhere on the
 *     plane. The same holds for a new row below a lane's content (rowInLane)
 *  Obstacles are the frame's content plus whatever is drawn inside the frame
 *  without belonging to it (annotations and data in a lane, collaboration
 *  annotations in a pool). Groups are obstacles, except a group drawn around
 *  the anchor: the new node may go inside it (layout/IncrementalLayout.ts grows the group),
 *  and on a plane without pools that group confines the space tool like a
 *  pool. A boundary event avoids the spots where connections dock on the
 *  host. A relocated node keeps its size and DI; a BPMNShape without valid
 *  bounds (plane.unbounded) is reused for its element; a host drawn for the
 *  first time gets its already drawn boundary events back on its border.
 *   - a node whose lane differs from its anchor's goes to a free row of its
 *     own lane band (rowInLane, also used for lane changes)
 *  Sizes follow the drawing (median size of shapes of the same kind on the
 *  plane), else the engine's SIZES. Every placed shape is moved inside its
 *  frame's interior at the top / left and fitted into it at the right /
 *  bottom with its label (frames grow, see SpaceTool.ts fitInFrame); a new
 *  gateway at the top of an expanded sub-process gets room below the title
 *  for its label above it (SpaceTool.ts roomBelowTitle).
 *
 *  changeLane(plane, id) moves an existing node into its (new) lane: same x,
 *  the free row of the target lane band preferred for its neighbours, else a
 *  new row below (the lane grows).
 *
 *  placeArtifact(id): text annotation above-right of the element it is
 *  associated with, data object / store below-right of the activity it is
 *  connected to (unconnected: like an unconnected node).
 */
import { LayoutDebug } from '../shared/LayoutDebug.js';
import { annotationSize, SIZES } from './utils/sizes.js';
import { is, type El } from '../model/utils/moddle.js';
import { bottom, clamp, cx, cy, median, overlaps, pathHits, right, segmentHits, segmentsCross, type Box, type Point } from './utils/geom.js';
import { defaultLabelSide, hasExternalLabel, labelAt, labelSideOf } from './utils/labels.js';
import { boundariesOf, frameOf, frameInterior, idOf, inFrame, isLeaf, isSubProcess, predecessors, raw, rawList, sequenceFlows, shapeKind, spacingOf, successors, type Spacing } from './utils/plane.js';

import type { DEdge, DShape, Plane, ShapeKind } from './types.js';
import type { Semantics } from './Semantics.js';
import { attachedSide, defaultSides } from './utils/sides.js';
import { OrthogonalRouter } from './OrthogonalRouter.js';
import { Drawing } from './Drawing.js';
import { labelSize } from './utils/text.js';

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
   * called after placeFlowNodes placed a node when more nodes follow: its
   * sequence flows to drawn nodes are routed (and labelled) right away, so
   * what a batch places next sees them like the next single command would
   * (layout/IncrementalLayout.ts routeNow)
   */
  afterNode?(plane: Plane, id: string): void;
}

/** What a placement run changes in its placer, to undo it (NodePlacer checkpoint / restore). */
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

interface Shift {
  line: number;
  delta: number;
  within?: Box;
  frame?: string;
}

interface Cand {
  x: number;
  c: number;
  size: { width: number; height: number };
  penalty: number;
  /** room the new nodes that follow on the row need right of the box (chainExtent) */
  extent?: number;
  /** a row opened with the space tool before placing */
  insert?: Shift;
  /** the frame growth placing there causes (fitInFrame), for the cost estimate */
  grow?: Shift;
  /** a boundary event's path above its host: the event's spot on the host's top border */
  top?: Box;
}

/** cost of a crossing in the trial route (connectionCost) and on the chain's row (chainCost) */
const CROSSING = 300;
/** an existing line running through the room the new nodes take: it is routed around them (and mostly crosses) */
const LINE_HIT = 400;
/** an opened row: its base penalty, per shape it moves (capped, so that one crossing always costs more), per px */
const OPEN_ROW = 100;
const OPEN_PER_SHAPE = 3;
const OPEN_MAX_SHAPES = 40;
/** a boundary event's path above its host instead of below (the convention): a clean row below costs less */
const TOP_ROW = 160;

interface Probe {
  id: string;
  kind: DShape['kind'];
  parentId?: string;
  laneId?: string;
  poolId?: string;
}

/** What a label above or below its shape reaches out beyond the shape's left and right edge. */
interface LabelReach {
  side: 'above' | 'below';
  left: number;
  right: number;
}

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
  /** nodes placed in this run as a splice: the successor S they were spliced before (a chain of new nodes continues it) */
  spliced?: Map<string, string>;
  /** joins placed again right of their rightmost predecessor, before this successor (layout/IncrementalLayout.ts pullJoins) */
  joins?: Map<string, string>;
  /** shapes whose label is placed again at the end (a boundary event moved to the top border) */
  relabel?: Set<string>;
  /** heads of branches and exception paths placed in this run: the number of row candidates they had */
  heads?: Map<string, number>;
  /** the local repair's request: start this head at its n-th cheapest candidate (0 = the cheapest) */
  skip?: Map<string, number>;
  /** nodes placed as the continuation of a chain (on their anchor's row, no row choice): a line touching them is routed again */
  continued?: Set<string>;
  private readonly drawings = new Map<Plane, Drawing>();

  constructor(
    private readonly planes: Plane[],
    private readonly sem: Semantics,
    /** sequence flows whose source / target changed: their ids before the ops */
    private readonly oldSource: ReadonlyMap<string, string>,
    readonly oldTarget: ReadonlyMap<string, string>,
    /** new sub-processes drawn collapsed (all others are expanded) */
    readonly collapsed: ReadonlySet<string>,
    private readonly notes: string[],
    private readonly hooks: PlacementHooks,
  ) {
    this.spacing = new Map(planes.map((p) => [p, spacingOf(p)]));
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

  private drawing(plane: Plane): Drawing {
    let d = this.drawings.get(plane);
    if (!d) this.drawings.set(plane, (d = new Drawing(plane)));
    return d;
  }

  private spacingFor(plane: Plane): Spacing {
    let s = this.spacing.get(plane);
    if (!s) {
      s = spacingOf(plane);
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
  private sizeFor(plane: Plane, id: string): { width: number; height: number } {
    const block = this.blockSize.get(id);
    if (block) return block;
    // a relocated node keeps its size (an expanded sub-process its content too)
    const reused = this.reuse.get(id)?.shape.bounds;
    if (reused) return { width: reused.width, height: reused.height };
    const el = this.sem.byId.get(id)!;
    const kind = shapeKind(el);
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
    const kind = shapeKind(el);
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
    if (scope && sid && isSubProcess(scope) && plane.shapes.get(sid)?.expanded) s.parentId = sid;
    if (reuse?.shape.label) {
      const old = reuse.shape.bounds;
      s.label = { ...reuse.shape.label, x: reuse.shape.label.x + bounds.x - old.x, y: reuse.shape.label.y + bounds.y - old.y };
    }
    return s;
  }

  /** Adds a placed shape to the plane, brings reused boundary events along and fits it into its frame. */
  private commit(plane: Plane, s: DShape): void {
    // never above / left of the frame's interior (fitInFrame below only grows a frame to the right and down)
    const frame = s.kind === 'boundary' ? undefined : frameOf(plane, s);
    if (frame) {
      const inner = frameInterior(frame, 15);
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
    if (!reuse && s.kind !== 'boundary') this.reattachBoundaries(plane, s);
  }

  /** The centre of a boundary event lies on its host's border (a few px tolerance). */
  private onBorder(event: Box, host: Box, tol = 6): boolean {
    const c = { x: cx(event), y: cy(event) };
    const inX = c.x >= host.x - tol && c.x <= right(host) + tol;
    const inY = c.y >= host.y - tol && c.y <= bottom(host) + tol;
    const near = Math.min(Math.abs(c.x - host.x), Math.abs(c.x - right(host)), Math.abs(c.y - host.y), Math.abs(c.y - bottom(host))) <= tol;
    return inX && inY && near;
  }

  /**
   * A host drawn for the first time whose boundary events already had shapes
   * (DI of the event but not of the host): the events are put on its border,
   * keeping their DI and labels.
   */
  private reattachBoundaries(plane: Plane, host: DShape): void {
    for (const b of boundariesOf(plane, host.id)) {
      if (this.onBorder(b.bounds, host.bounds)) continue;
      plane.shapes.delete(b.id);
      this.reuse.set(b.id, { shape: b, boundaries: [], from: plane });
      if (this.placeBoundary(plane, b.id)) {
        this.placed.delete(b.id);
        this.moved.add(b.id);
      } else {
        this.reuse.delete(b.id);
        plane.shapes.set(b.id, b);
      }
    }
  }

  /** True when `frame` is `s`'s frame or an ancestor of it. */
  private within(plane: Plane, s: DShape, frame: DShape | undefined): boolean {
    return inFrame(plane, s, frame);
  }

  /**
   * Obstacles for a new shape in `frame`: its content (leaf shapes with their
   * boundary events, expanded sub-processes, labels), and whatever else is
   * drawn inside it without belonging to it semantically (an annotation or data
   * object in a lane, a collaboration-level annotation in a pool). Groups are
   * obstacles too, except the ones in `exclude` (the groups the anchor sits in).
   * `plain` false: no groups and no connection labels (contentBottom adds the
   * ones inside the frame).
   */
  private obstacles(plane: Plane, frame: DShape | undefined, exclude: ReadonlySet<string>, plain = true): { boxes: Box[]; labels: Box[] } {
    const boxes: Box[] = [];
    const labels: Box[] = [];
    for (const s of plane.shapes.values()) {
      if (exclude.has(s.id) || s === frame) continue;
      // groups are drawn frames around content: new shapes stay out of them
      if (s.kind === 'group') {
        if (plain) boxes.push(s.bounds);
        continue;
      }
      const solid = isLeaf(s) || (s.kind === 'subProcess' && s.container);
      const member = this.within(plane, s, frame);
      const drawnIn = !member && !!frame && solid && overlaps(s.bounds, frame.bounds) && !inFrame(plane, frame, s);
      if (!member && !drawnIn) {
        if (frame && s.label && overlaps(s.label, frame.bounds)) labels.push(s.label);
        continue;
      }
      if (solid) boxes.push(isLeaf(s) && !s.hostId ? this.drawing(plane).unitBox(s) : s.bounds);
      if (s.label) labels.push(s.label);
    }
    if (plain) for (const e of plane.edges.values()) if (e.label) labels.push(e.label);
    return { boxes, labels };
  }

  /** Groups drawn around one of the anchors: a node placed next to its anchor may go inside them (they grow). */
  private homeGroups(plane: Plane, anchors: ReadonlyArray<DShape | undefined>): string[] {
    const out: string[] = [];
    for (const g of plane.shapes.values()) {
      if (g.kind !== 'group') continue;
      if (anchors.some((a) => !!a && cx(a.bounds) > g.bounds.x && cx(a.bounds) < right(g.bounds) && cy(a.bounds) > g.bounds.y && cy(a.bounds) < bottom(g.bounds))) out.push(g.id);
    }
    return out;
  }

  private isFree(box: Box, obs: { boxes: Box[]; labels: Box[] }, clearance = 20): boolean {
    return !obs.boxes.some((b) => overlaps(b, box, clearance)) && !obs.labels.some((l) => overlaps(l, box, 4));
  }

  /**
   * Where a space-tool run for a node goes: inside its expanded sub-process
   * (frame mode: the sub-process never grows over foreign shapes, SpaceTool.ts),
   * else within its pool.
   */
  private spaceBand(plane: Plane, s: Pick<DShape, 'parentId' | 'poolId'>, anchor?: DShape): { within?: Box; frame?: string } {
    const sub = s.parentId ? plane.shapes.get(s.parentId) : undefined;
    if (sub) return { within: { ...sub.bounds }, frame: sub.id };
    const pool = s.poolId ? plane.shapes.get(s.poolId) : undefined;
    if (pool) return { within: { ...pool.bounds } };
    // no pool: a group drawn around the anchor confines the space tool like a pool would (hand drawings in columns)
    const group = anchor ? this.homeGroups(plane, [anchor]).map((id) => plane.shapes.get(id)!).sort((a, b) => a.bounds.width * a.bounds.height - b.bounds.width * b.bounds.height)[0] : undefined;
    return group ? { within: { ...group.bounds } } : {};
  }

  private recordSpace(r: { moved: Set<string> }): void {
    r.moved.forEach((x) => this.moved.add(x));
  }

  /** The centre of `b` lies inside `frame` (the plane: always). */
  private centreIn(b: Box, frame: DShape | undefined): boolean {
    if (!frame) return true;
    const f = frame.bounds;
    return cx(b) > f.x && cx(b) < right(f) && cy(b) > f.y && cy(b) < bottom(f);
  }

  /**
   * Bottom of the content of a frame, or undefined when it is empty: its
   * members (with their labels), what is drawn inside it, and the labels of the
   * connections inside it (both ends members, or the label inside the frame).
   * What lies outside the frame (a label of a flow elsewhere on the plane, a
   * group around something else) never counts.
   */
  private contentBottom(plane: Plane, frame: DShape | undefined, exclude: ReadonlySet<string>): number | undefined {
    const obs = this.obstacles(plane, frame, exclude, false);
    const member = (id: string | undefined): boolean => {
      const s = id ? plane.shapes.get(id) : undefined;
      return !!s && s !== frame && this.within(plane, s, frame);
    };
    const edgeLabels = [...plane.edges.values()].filter((e) => e.label && ((member(e.sourceId) && member(e.targetId)) || this.centreIn(e.label, frame))).map((e) => e.label!);
    const groups = [...plane.shapes.values()].filter((g) => g.kind === 'group' && !exclude.has(g.id) && this.centreIn(g.bounds, frame)).map((g) => g.bounds);
    const all = [...obs.boxes, ...obs.labels, ...edgeLabels, ...groups];
    return all.length ? Math.max(...all.map(bottom)) : undefined;
  }

  /** Thin boxes of all edge segments (to keep new rows off existing lines). */
  private edgeBoxes(plane: Plane): Box[] {
    const out: Box[] = [];
    for (const e of plane.edges.values()) {
      for (let i = 0; i + 1 < e.points.length; i++) {
        const p = e.points[i]!;
        const q = e.points[i + 1]!;
        out.push({ x: Math.min(p.x, q.x), y: Math.min(p.y, q.y), width: Math.abs(p.x - q.x), height: Math.abs(p.y - q.y) });
      }
    }
    return out;
  }

  /**
   * Up to `count` free row centres at or below `startCy` (shape-free; rows on
   * existing lines are flagged). `extent`: room right of the box the new nodes
   * that follow need, kept free of shapes only (a label or a line there is
   * dealt with when the chain is drawn, like single commands would).
   */
  private freeRows(plane: Plane, frame: DShape | undefined, x: number, width: number, height: number, startCy: number, step: number, exclude: ReadonlySet<string>, count: number, extent = 0, up = false): Array<{ c: number; onLine: boolean }> {
    const obs = this.obstacles(plane, frame, exclude);
    const shapesOnly = { boxes: obs.boxes, labels: [] };
    const segs = this.edgeBoxes(plane);
    const out: Array<{ c: number; onLine: boolean }> = [];
    for (let k = 0; k < 40 && out.length < count; k++) {
      const c = startCy + (up ? -k : k) * step;
      const box = { x, y: c - height / 2, width, height };
      if (!this.isFree(box, obs) || (extent > 0 && !this.isFree({ ...box, x: x + width, width: extent }, shapesOnly))) continue;
      out.push({ c, onLine: segs.some((sg) => overlaps(sg, box, 4)) });
    }
    if (!out.length && !up) out.push({ c: startCy, onLine: false });
    return out;
  }

  private shiftedBox(b: Box, sh: Shift | undefined): Box {
    return sh && b.y >= sh.line ? { ...b, y: b.y + sh.delta } : b;
  }

  private shiftedLine(pts: Point[], sh: Shift | undefined): Point[] {
    return sh ? pts.map((p) => (p.y >= sh.line ? { x: p.x, y: p.y + sh.delta } : p)) : pts;
  }

  /**
   * What connecting `from` to a candidate box would cost: a trial route through
   * the drawing (router.ts), charged for cut shapes, crossed lines, labels hit,
   * bends and length. `shift` approximates a row opened by the space tool.
   */
  private connectionCost(plane: Plane, from: DShape, to: Box, toKind: ShapeKind, shift?: Shift): number {
    const host = from.hostId ? plane.shapes.get(from.hostId) : undefined;
    const obstacles: Box[] = [];
    for (const o of plane.shapes.values()) {
      if (o.id === from.id || o.kind === 'group') continue;
      if (isLeaf(o) || (o.kind === 'subProcess' && o.container && o.id !== from.parentId)) obstacles.push(this.shiftedBox(o.bounds, shift));
    }
    const flows = [...plane.edges.values()].map((e) => this.shiftedLine(e.points, shift)).filter((p) => p.length >= 2);
    const lines = this.drawing(plane).routingLines().map((l) => this.shiftedLine(l, shift));
    const hostBox = host ? this.shiftedBox(host.bounds, shift) : undefined;
    const sourceSides = from.kind === 'boundary' && hostBox ? [attachedSide(from.bounds, hostBox)] : defaultSides(from.kind, 'source');
    const pts = OrthogonalRouter.route({ source: from.bounds, target: to, sourceSides, targetSides: defaultSides(toKind, 'target'), obstacles, lines });
    let cost = 0;
    for (let i = 0; i + 1 < pts.length; i++) cost += Math.abs(pts[i + 1]!.x - pts[i]!.x) + Math.abs(pts[i + 1]!.y - pts[i]!.y);
    cost = cost * 0.5 + (pts.length - 2) * 30;
    for (const o of obstacles) if (o !== hostBox && pathHits(pts, o)) cost += 2000;
    for (const line of flows) {
      for (let i = 0; i + 1 < pts.length; i++) {
        for (let j = 0; j + 1 < line.length; j++) if (segmentsCross(pts[i]!, pts[i + 1]!, line[j]!, line[j + 1]!)) cost += CROSSING;
      }
    }
    const labels = [...plane.shapes.values(), ...plane.edges.values()].map((x) => x.label).filter((l): l is Box => !!l);
    for (const l of labels) for (let i = 0; i + 1 < pts.length; i++) if (segmentHits(pts[i]!, pts[i + 1]!, this.shiftedBox(l, shift), 0)) cost += 60;
    return cost;
  }

  /**
   * What the rest of a chain on the candidate's row would cost: the new nodes
   * that follow take the room right of the box (`extent`), joined by a line on
   * the row. Every existing line (after the shift) that crosses that line costs
   * a crossing, one that runs through that room (or, for an opened row or a row
   * above the host, through the box itself) costs LINE_HIT: it would be routed
   * around the new shapes.
   */
  private chainCost(plane: Plane, box: Box, cand: Cand): number {
    const shift = cand.insert ?? cand.grow;
    const extent = cand.extent ?? 0;
    const run = extent > 0 ? ([{ x: right(box), y: cy(box) }, { x: right(box) + extent, y: cy(box) }] as const) : undefined;
    const rest = extent > 0 ? { x: right(box), y: box.y, width: extent, height: box.height } : undefined;
    const head = cand.insert || cand.top ? box : undefined;
    let cost = 0;
    for (const e of plane.edges.values()) {
      const line = this.shiftedLine(e.points, shift);
      for (let j = 0; j + 1 < line.length; j++) {
        const p = line[j]!;
        const q = line[j + 1]!;
        if (run && segmentsCross(run[0], run[1], p, q)) {
          cost += CROSSING;
          if (LayoutDebug.on()) LayoutDebug.log(`[place]   chain at c=${cand.c} crosses ${e.id}`);
        } else if ((rest && segmentHits(p, q, rest, 2)) || (head && segmentHits(p, q, head, 2))) {
          cost += LINE_HIT;
          if (LayoutDebug.on()) LayoutDebug.log(`[place]   chain at c=${cand.c} is hit by ${e.id}`);
        }
      }
    }
    return cost;
  }

  /**
   * The candidate a branch or exception path starts at: the cheapest by
   * connectionCost and chainCost plus its penalty, or, when the local repair
   * asked for it (skip: the chain crossed a line after placement,
   * layout/IncrementalLayout.ts), the next cheapest one. The head and its number of
   * candidates are recorded (heads), so the repair knows what it can retry.
   */
  private cheapest(id: string, plane: Plane, from: DShape, kind: ShapeKind, cands: Cand[]): Cand {
    const ranked: Array<{ cand: Cand; cost: number }> = [];
    for (const cand of cands) {
      const box = { x: cand.x, y: cand.c - cand.size.height / 2, ...cand.size };
      const source = { ...from, bounds: cand.top ?? this.shiftedBox(from.bounds, cand.insert ?? cand.grow) };
      const cost = this.connectionCost(plane, source, box, kind, cand.insert ?? cand.grow) + this.chainCost(plane, box, cand) + cand.penalty;
      if (LayoutDebug.on()) LayoutDebug.log(`[place] from ${from.id} x=${cand.x} c=${cand.c} penalty=${Math.round(cand.penalty)} cost=${Math.round(cost)}${cand.insert ? ` insert ${cand.insert.delta}` : ''}${cand.grow ? ` grow ${cand.grow.delta}` : ''}${cand.top ? ' top' : ''}`);
      ranked.push({ cand, cost });
    }
    // stable: equal costs keep the candidates' order
    ranked.sort((a, b) => a.cost - b.cost);
    (this.heads ??= new Map()).set(id, ranked.length);
    const k = Math.min(this.skip?.get(id) ?? 0, ranked.length - 1);
    if (k > 0 && LayoutDebug.on()) LayoutDebug.log(`[place] ${id}: candidate ${k + 1} of ${ranked.length} (the local repair retries the chain)`);
    return ranked[k]?.cand ?? cands[0]!;
  }

  /**
   * Horizontal segments of existing lines that a route from the anchor down to
   * a row would cross or that run through the row: their y between `floor` and
   * `below`, overlapping [x0, x1] (bypass and loop-back lines under the anchor).
   */
  private linesUnder(plane: Plane, x0: number, x1: number, floor: number, below: number): number[] {
    const out: number[] = [];
    for (const e of plane.edges.values()) {
      const n = e.points.length;
      for (let i = 0; i + 1 < n; i++) {
        const p = e.points[i]!;
        const q = e.points[i + 1]!;
        if (Math.abs(p.y - q.y) > 0.5 || p.y <= floor + 0.5 || p.y > below) continue;
        if (Math.max(p.x, q.x) < x0 || Math.min(p.x, q.x) > x1) continue;
        out.push(p.y);
        // a segment docking on a shape below the anchor: the shape moves with it (the line stays orthogonal)
        for (const end of [i === 0 ? e.sourceId : undefined, i + 1 === n - 1 ? e.targetId : undefined]) {
          const s = end ? plane.shapes.get(end) : undefined;
          if (s && isLeaf(s) && s.bounds.y > floor + 0.5) out.push(s.bounds.y);
        }
      }
    }
    return out;
  }

  /**
   * Candidate rows at or below `first` for a box at `x`: the first free rows, and
   * (when the first row is taken by shapes or a line, or a line runs between the
   * anchor and it) that row opened with the space tool: everything at or below
   * the topmost thing in the way moves down, the horizontal segments of lines
   * running under the anchor (bypass and loop-back lines) included, so the route
   * from the anchor (leaving it downwards at `descend`) reaches the row without
   * crossing them. An opened row costs less than one crossing.
   */
  private rowCandidates(plane: Plane, probe: Pick<DShape, 'parentId' | 'poolId'>, frame: DShape | undefined, x: number, size: { width: number; height: number }, extent: number, first: number, step: number, floor: number, exclude: ReadonlySet<string>, basePenalty = 0, anchor?: DShape, descend?: number): Cand[] {
    const rows = this.freeRows(plane, frame, x, size.width, size.height, first, step, exclude, 3, extent);
    const band = this.spaceBand(plane, probe, anchor);
    const moving = (line: number): number => [...plane.shapes.values()].filter((s) => isLeaf(s) && s.bounds.y >= line && (!band.within || (s.bounds.x < right(band.within) && right(s.bounds) > band.within.x))).length;
    const cands: Cand[] = rows.map((r, k) => {
      const cand: Cand = { x, c: r.c, size, extent, penalty: basePenalty + 60 * k + (r.onLine ? 700 : 0) + Math.max(0, (r.c - first) / step - 1) * 40 };
      // a row below the frame's interior grows the frame: content below it moves away (the shape keeps clear of the
      // frame's boundary events on its bottom border, SpaceTool.ts borderPad)
      const pad = frame ? Math.max(15, this.drawing(plane).borderPad(frame, { x, y: r.c - size.height / 2, ...size }, 'y')) : 15;
      if (frame && r.c + size.height / 2 + pad > bottom(frame.bounds)) {
        const line = bottom(frame.bounds) - 1;
        const delta = Math.ceil(r.c + size.height / 2 + pad - bottom(frame.bounds));
        cand.grow = { line, delta, ...band };
        cand.penalty += 10 * moving(line) + delta * 0.3;
      }
      return cand;
    });
    const box = { x, y: first - size.height / 2, width: size.width + extent, height: size.height };
    const x0 = Math.min(descend ?? x, x) - 10;
    const lines = this.linesUnder(plane, x0, right(box) + 10, floor, bottom(box) + 20);
    const clean = rows.some((r) => Math.abs(r.c - first) < 1 && !r.onLine);
    if (clean && !lines.length) return cands;
    const blockers = this.obstacles(plane, frame, exclude).boxes.filter((b) => overlaps(b, box, 20));
    const tops = [...blockers.map((b) => b.y), ...lines];
    if (!tops.length) return cands;
    const top = Math.min(...tops);
    if (top <= floor) return cands;
    const insert: Shift = { line: top - 0.5, delta: Math.ceil(bottom(box) + 20 - top), ...band };
    if (LayoutDebug.on()) LayoutDebug.log(`[place] open row c=${first} floor=${Math.round(floor)} line=${insert.line} delta=${insert.delta} lines=${lines.join(',')} blockers=${blockers.map((b) => b.y).join(',')}`);
    const n = Math.min(OPEN_MAX_SHAPES, moving(insert.line));
    cands.push({ x, c: first, size, extent, penalty: basePenalty + OPEN_ROW + OPEN_PER_SHAPE * n + insert.delta * 0.2, insert });
    return cands;
  }

  /** Places at a chosen candidate (opening its row first; a path above its host takes the event to the top border first). */
  private placeCand(plane: Plane, id: string, probe: Probe, cand: Cand, anchor: DShape): void {
    if (cand.insert) {
      const { line, delta, within, frame } = cand.insert;
      this.recordSpace(this.drawing(plane).makeSpace({ axis: 'y', line, delta, anchors: [anchor.id, probe.parentId], ...(within ? { within } : {}), ...(frame ? { frame } : {}) }));
    }
    // the spot after the room was made
    if (cand.top) this.seatOnTop(plane, anchor, cand.top);
    this.placeAt(plane, id, cand.x, this.intoOwnLane(plane, probe, cand.x, cand.c, cand.size, [], anchor), cand.size);
  }

  /** Row centres used in a lane (clustered node centres), most populated first. */
  private laneRows(plane: Plane, lane: DShape, tol: number, exclude: ReadonlySet<string>): number[] {
    const centres = [...plane.shapes.values()].filter((s) => isLeaf(s) && s.kind !== 'boundary' && s.laneId === lane.id && !exclude.has(s.id)).map((s) => cy(s.bounds)).sort((a, b) => a - b);
    const clusters: Array<{ c: number; n: number }> = [];
    for (const c of centres) {
      const last = clusters[clusters.length - 1];
      if (last && c - last.c <= tol) {
        last.c = (last.c * last.n + c) / (last.n + 1);
        last.n++;
      } else clusters.push({ c, n: 1 });
    }
    return clusters.sort((a, b) => b.n - a.n || a.c - b.c).map((k) => Math.round(k.c));
  }

  /**
   * A free row centre for a box at `x` inside lane `lane`: rows of `prefer`
   * (neighbours) first, then the lane's rows (most populated first, as close
   * to the lane border as its shapes sit), the lane centre when it is empty,
   * else a new row below its own content.
   */
  private rowInLane(plane: Plane, lane: DShape, x: number, width: number, height: number, prefer: number[], exclude: ReadonlySet<string>): number {
    const sp = this.spacingFor(plane);
    const obs = this.obstacles(plane, lane, exclude);
    const inner = frameInterior(lane, 10);
    const fitsIn = (c: number, b: Box): boolean => c - height / 2 >= b.y - 0.5 && c + height / 2 <= bottom(b) + 0.5;
    const rows = this.laneRows(plane, lane, sp.rowTol, exclude);
    // the lane's own rows are used as tightly as the drawing uses them; anything else keeps 10 px from the borders
    const candidates = [...prefer.filter((c) => fitsIn(c, inner)), ...rows.filter((c) => fitsIn(c, lane.bounds))];
    if (!rows.length) candidates.push(Math.round(cy(inner)));
    for (const c of candidates) {
      if (this.isFree({ x, y: c - height / 2, width, height }, obs)) return c;
    }
    const below = this.contentBottom(plane, lane, exclude);
    return Math.round((below ?? inner.y) + Math.max(30, sp.row - 80) + height / 2);
  }

  /** Moves an existing node into its (new) lane: same x, a free row of the lane band. */
  changeLane(plane: Plane, id: string): boolean {
    const s = plane.shapes.get(id);
    const lane = s?.laneId ? plane.shapes.get(s.laneId) : undefined;
    if (!s || !lane) return false;
    const inner = frameInterior(lane, 2);
    const inLane = (): boolean => s.bounds.y >= inner.y && bottom(s.bounds) <= bottom(inner) && s.bounds.x >= lane.bounds.x && right(s.bounds) <= right(lane.bounds);
    if (inLane()) return false;
    const exclude = new Set([id, ...boundariesOf(plane, id).map((b) => b.id)]);
    const neighbours = [...predecessors(this.sem, id), ...successors(this.sem, id)]
      .map((n) => plane.shapes.get(n))
      .filter((n): n is DShape => !!n && n.laneId === lane.id)
      .map((n) => Math.round(cy(n.bounds)));
    const c = this.rowInLane(plane, lane, s.bounds.x, s.bounds.width, s.bounds.height, neighbours, exclude);
    const dy = Math.round(c - s.bounds.height / 2 - s.bounds.y);
    for (const m of this.drawing(plane).shift(id, 0, dy)) this.moved.add(m);
    // a row of the lane's own (as close to the border as its shapes sit) needs no growth
    if (!inLane()) this.recordSpace(this.drawing(plane).fitInFrame(id, 15));
    return true;
  }

  private probeOf(plane: Plane, id: string): Probe {
    const s = this.newShape(plane, id, { x: 0, y: 0, width: 0, height: 0 });
    return { id, kind: s.kind, ...(s.parentId ? { parentId: s.parentId } : {}), ...(s.laneId ? { laneId: s.laneId } : {}), ...(s.poolId ? { poolId: s.poolId } : {}) };
  }

  /**
   * Room the new nodes that follow `id` in a simple chain need on its row (a
   * branch row is chosen for all of them). A node without any successor yet
   * (not an end event) keeps room for one event: the next command mostly ends
   * its branch there, so a batch and the same ops as single commands choose
   * the same row.
   */
  private chainExtent(plane: Plane, id: string, pending: ReadonlySet<string>, gap: number): number {
    if (!successors(this.sem, id).length && !is(this.sem.byId.get(id), 'bpmn:EndEvent')) return SIZES.event.width + gap;
    let extent = 0;
    let cur = id;
    for (let i = 0; i < 4; i++) {
      const next = successors(this.sem, cur).filter((n) => pending.has(n) && n !== id);
      if (next.length !== 1) break;
      cur = next[0]!;
      extent += this.sizeFor(plane, cur).width + gap;
    }
    return extent;
  }

  /** Places a boundary event on its host's bottom border. */
  private placeBoundary(plane: Plane, id: string): boolean {
    const el = this.sem.byId.get(id)!;
    const hostId = idOf(raw(el, 'attachedToRef'));
    const host = hostId ? plane.shapes.get(hostId) : undefined;
    if (!host) return false;
    const box = this.boundarySpot(plane, host, this.sizeFor(plane, id));
    if (box.y > host.bounds.y) this.makeRoomBelow(plane, host, box);
    this.commit(plane, this.newShape(plane, id, box));
    return true;
  }

  /**
   * The spot placeBoundary gives a new boundary event on its host: the bottom
   * border right to left (the corner included), then the top border; first
   * with a clear exit. `self`: an event already drawn there, left out (where
   * a command would have put it).
   */
  private boundarySpot(plane: Plane, host: DShape, size: { width: number; height: number }, self?: string): Box {
    const hb = host.bounds;
    const others = boundariesOf(plane, host.id).filter((b) => b.id !== self).map((b) => b.bounds);
    const offset = Math.min(SIZES.event.width / 2 + 7, hb.width / 2);
    // the flow leaves a bottom boundary event downwards: keep that lane clear of other labels
    const labels = [...plane.shapes.values()].filter((o) => o.id !== host.id && o.id !== self && o.label).map((o) => o.label!);
    const exitClear = (b: Box): boolean => b.y < hb.y || !labels.some((l) => overlaps(l, { x: b.x + b.width / 2 - 2, y: bottom(b), width: 4, height: 40 }));
    // where connections already dock on the host's border (a boundary event there would force them around)
    const docks: Point[] = [];
    for (const e of plane.edges.values()) {
      if (e.points.length < 2 || (self && e.sourceId === self)) continue;
      if (e.sourceId === host.id) docks.push(e.points[0]!);
      if (e.targetId === host.id) docks.push(e.points[e.points.length - 1]!);
    }
    const onDock = (b: Box): boolean => docks.some((p) => p.x > b.x - 4 && p.x < right(b) + 4 && p.y > b.y - 4 && p.y < bottom(b) + 4);
    let strict = true;
    const free = (b: Box): boolean => !others.some((o) => overlaps(o, b, 4)) && !onDock(b) && (!strict || (exitClear(b) && !labels.some((l) => overlaps(l, b, 2))));
    for (const [y, clear] of [[bottom(hb) - size.height / 2, true], [bottom(hb) - size.height / 2, false], [hb.y - size.height / 2, false]] as const) {
      strict = clear;
      const centres: number[] = [];
      for (let c = right(hb) - offset; c >= hb.x + size.width / 2 - 0.5; c -= 4) centres.push(c);
      for (let c = right(hb) - offset + 4; c <= right(hb); c += 4) centres.push(c);
      for (const c of centres) {
        const cand = { x: Math.round(c - size.width / 2), y: Math.round(y), ...size };
        if (free(cand)) return cand;
      }
    }
    return { x: Math.round(right(hb) - offset - size.width / 2), y: Math.round(bottom(hb) - size.height / 2), ...size };
  }

  /**
   * A boundary event on the bottom border needs room below the host for its
   * outgoing flow: shapes right below it are pushed down (space tool).
   */
  private makeRoomBelow(plane: Plane, host: DShape, event: Box): void {
    const zone = { x: event.x - 10, y: bottom(host.bounds), width: event.width + 20, height: event.height / 2 + 35 };
    const own = new Set([host.id, ...boundariesOf(plane, host.id).map((b) => b.id)]);
    const blockers = [...plane.shapes.values()].filter((o) => !own.has(o.id) && (isLeaf(o) || (o.kind === 'subProcess' && o.container && o.id !== host.parentId)) && overlaps(o.bounds, zone));
    if (!blockers.length) return;
    const top = Math.min(...blockers.map((b) => b.bounds.y));
    if (top < bottom(host.bounds) - 0.5) return;
    this.recordSpace(this.drawing(plane).makeSpace({ axis: 'y', line: top - 0.5, delta: Math.ceil(bottom(zone) + 10 - top), anchors: [host.id], ...this.spaceBand(plane, host, host) }));
  }

  /**
   * The successor S of a spliced node N (the flow into N ended at S before the
   * ops), also through a chain of new nodes (one batch that splices a task and
   * then a gateway after it into one flow: each is spliced before S like with
   * single commands, the task first). The chain may branch: a new gateway in
   * it with a new "no" branch, or a `split`, keeps the splice of the nodes on
   * the way to S; a new branch that never reaches S is no splice.
   */
  private spliceTarget(plane: Plane, id: string, pred: string): string | undefined {
    const el = this.sem.byId.get(id);
    const join = this.joins?.get(id);
    if (join) return join;
    // inside the chain: the predecessor was spliced before S in this run, and S still follows this node
    const before = this.placed.has(pred) ? this.spliced?.get(pred) : undefined;
    if (before && before !== id && this.chainReaches(plane, id, before)) return before;
    const succ = new Set(successors(this.sem, id));
    for (const f of sequenceFlows(el, 'incoming')) {
      const fid = idOf(f);
      if (!fid || idOf(raw(f, 'sourceRef')) !== pred) continue;
      const old = this.oldTarget.get(fid);
      if (old && old !== id && (succ.has(old) || this.chainReaches(plane, id, old))) return old;
    }
    for (const f of sequenceFlows(el, 'outgoing')) {
      const fid = idOf(f);
      const target = idOf(raw(f, 'targetRef'));
      if (!fid || !target) continue;
      const old = this.oldSource.get(fid);
      if (old === pred) return target;
    }
    return undefined;
  }

  /**
   * Whether `target` follows `id` through new nodes (not drawn before this
   * run): every successor is followed, so a split inside the chain (a new
   * gateway with a second outgoing flow, the branches of a `split`) keeps the
   * splice; a node drawn before the run ends a path. At most 50 nodes.
   */
  private chainReaches(plane: Plane, id: string, target: string): boolean {
    const seen = new Set<string>([id]);
    const queue = [id];
    while (queue.length && seen.size <= 50) {
      for (const n of successors(this.sem, queue.shift()!)) {
        if (n === target) return true;
        if (seen.has(n) || (plane.shapes.has(n) && !this.placed.has(n))) continue;
        seen.add(n);
        queue.push(n);
      }
    }
    return false;
  }

  private placeAt(plane: Plane, id: string, x: number, centreY: number, size: { width: number; height: number }): DShape {
    const s = this.newShape(plane, id, { x: Math.round(x), y: Math.round(centreY - size.height / 2), ...size });
    this.commit(plane, s);
    return s;
  }

  /**
   * Moves a candidate into the node's own lane when its anchor sits in another
   * lane (a candidate of a same-lane anchor may reach below the lane: it grows).
   */
  private intoOwnLane(plane: Plane, probe: Probe, x: number, c: number, size: { width: number; height: number }, prefer: number[], anchor?: DShape): number {
    const lane = probe.laneId ? plane.shapes.get(probe.laneId) : undefined;
    if (!lane || (anchor && anchor.laneId === probe.laneId && c - size.height / 2 >= frameInterior(lane, 5).y)) return c;
    const inner = frameInterior(lane, 5);
    if (c - size.height / 2 >= inner.y && c + size.height / 2 <= bottom(inner)) return c;
    return this.rowInLane(plane, lane, x, size.width, size.height, prefer, new Set([probe.id]));
  }

  /**
   * How far the space tool at `line` has to push for `box` when part of the room
   * is free already (audit #77): what is in the way of the box (its obstacles
   * with their clearance, the bends of connections in its rows) and the
   * successor `S` (one gap) must end right of it. Undefined when something in
   * the way does not start beyond the line (a push cannot clear it): then the
   * caller makes a full column of room as before.
   */
  private localShift(plane: Plane, box: Box, line: number, obs: { boxes: Box[]; labels: Box[] }, S: DShape | undefined, gap: number): number | undefined {
    let need = 0;
    const clear = (b: Box, room: number): boolean => {
      if (!overlaps(b, box, room)) return true;
      if (b.x < line) return false;
      need = Math.max(need, right(box) + room - b.x);
      return true;
    };
    for (const b of obs.boxes) if (!clear(b, 20)) return undefined;
    for (const l of obs.labels) if (!clear(l, 4)) return undefined;
    for (const e of plane.edges.values()) {
      for (const p of e.points.slice(1, -1)) if (!clear({ x: p.x, y: p.y, width: 0, height: 0 }, 10)) return undefined;
    }
    if (S && S.bounds.x >= line && Math.abs(cy(S.bounds) - cy(box)) <= box.height / 2 + S.bounds.height / 2) need = Math.max(need, right(box) + gap - S.bounds.x);
    return Math.ceil(need);
  }

  /** The reach of a drawn shape's label (undefined: none, or beside or on the shape). */
  private reachOf(s: DShape): LabelReach | undefined {
    const side = labelSideOf(s);
    if (!s.label || (side !== 'above' && side !== 'below')) return undefined;
    return { side, left: s.bounds.x - s.label.x, right: right(s.label) - right(s.bounds) };
  }

  /** The reach of the label a new node of `size` gets on its default side (utils/labels.ts; undefined: no name, no external label). */
  private newReach(id: string, size: { width: number; height: number }): LabelReach | undefined {
    const el = this.sem.byId.get(id);
    const kind = el ? shapeKind(el) : undefined;
    const name = raw<string>(el, 'name')?.trim();
    if (!kind || !name || kind === 'boundary' || !hasExternalLabel({ kind })) return undefined;
    const side = defaultLabelSide(kind);
    const over = (labelSize(name).width - size.width) / 2;
    return side === 'above' || side === 'below' ? { side, left: over, right: over } : undefined;
  }

  /** The gap two neighbours on a row need so that their labels on one side keep 4 px apart (0: other sides, or no label). */
  private labelRoom(a: LabelReach | undefined, b: LabelReach | undefined): number {
    return a && b && a.side === b.side ? Math.ceil(Math.max(0, a.right) + Math.max(0, b.left) + 4) : 0;
  }

  private placeAfter(plane: Plane, id: string, preds: DShape[], pending: ReadonlySet<string>): void {
    const sp = this.spacingFor(plane);
    const size = this.sizeFor(plane, id);
    const probe = this.probeOf(plane, id);
    const frame = frameOf(plane, probe);
    const main = preds[0]!;
    const exclude = new Set([id, ...this.homeGroups(plane, [main, main.hostId ? plane.shapes.get(main.hostId) : undefined])]);
    const kind = shapeKind(this.sem.byId.get(id)!);
    if (main.kind === 'boundary') {
      const host = main.hostId ? plane.shapes.get(main.hostId) : undefined;
      const anchor = host ?? main;
      const extent = this.chainExtent(plane, id, pending, sp.gap);
      const start = cy(anchor.bounds) + sp.row;
      const xs = [right(anchor.bounds) + sp.gap, Math.round(cx(main.bounds) - size.width / 2)];
      // an event on the top border: its path runs above the host (rows below cost TOP_ROW more), and what lies in the
      // host's own row (its flows, the events on them) is never in the way of a row below it
      const onTop = !!host && attachedSide(main.bounds, host.bounds) === 'top';
      const floor = Math.max(bottom(main.bounds), host ? bottom(host.bounds) : -Infinity);
      const cands = xs.flatMap((x, xi) => this.rowCandidates(plane, probe, frame, x, size, extent, start, sp.row, floor, exclude, 40 * xi + (onTop ? TOP_ROW : 0), anchor, cx(main.bounds)));
      if (host && onTop) cands.push(...xs.flatMap((x, xi) => this.rowsAbove(plane, probe, frame, main, x, size, extent, cy(host.bounds) - sp.row, sp.row, exclude, 40 * xi)));
      else if (host) cands.push(...this.topCandidates(plane, id, probe, main, host, frame, size, extent, exclude));
      this.placeCand(plane, id, probe, this.cheapest(id, plane, main, kind, cands), main);
      return;
    }
    const succShapes = successors(this.sem, main.id)
      .filter((n) => n !== id && plane.shapes.has(n))
      .map((n) => plane.shapes.get(n)!);
    const spliced = this.spliceTarget(plane, id, main.id);
    const S = spliced ? plane.shapes.get(spliced) : undefined;
    if (S) (this.spliced ??= new Map()).set(id, S.id);
    const maxRight = Math.max(...preds.map((p) => right(p.bounds)));
    if (S || !succShapes.length) {
      // splice / continuation on the anchor's row
      const sameRow = S && Math.abs(cy(S.bounds) - cy(main.bounds)) <= sp.rowTol;
      // a branching anchor: another branch is drawn, or was drawn before the ops and leads to a node a later op of
      // the batch spliced into it (still to be placed; a single command for this node would see that branch drawn)
      const branching = succShapes.length > 0 || sequenceFlows(this.sem.byId.get(main.id), 'outgoing').some((f) => idOf(raw(f, 'targetRef')) !== id && this.oldTarget.has(idOf(f) ?? ''));
      const onS = !!S && (sameRow || branching);
      let c = onS ? cy(S.bounds) : cy(main.bounds);
      // S's row in another lane than the node's own (a node keeping or given the anchor's lane after a branching
      // anchor): the row follows the node's lane, which never stretches over to S's row (audit #14)
      const ownRow = !!S && onS && !!probe.laneId && S.laneId !== probe.laneId;
      // the labels of neighbours on one side (events below, gateways above) keep apart: the gaps grow for them
      const reach = this.newReach(id, size);
      const gap = Math.max(sp.gap, this.labelRoom(this.reachOf(main), reach));
      const sGap = S ? this.labelRoom(reach, this.reachOf(S)) : 0;
      c = this.intoOwnLane(plane, probe, maxRight + gap, c, size, S ? [Math.round(cy(S.bounds))] : [], ownRow ? undefined : main);
      const x = maxRight + gap;
      const box = { x, y: c - size.height / 2, ...size };
      const blockers = this.obstacles(plane, frame, exclude);
      const succRoom = !S || Math.abs(cy(S.bounds) - c) > size.height / 2 + S.bounds.height / 2 || S.bounds.x >= right(box) + Math.max(Math.min(sp.gap, 40), sGap);
      if (!this.isFree(box, blockers) || !succRoom) {
        const full = size.width + gap + Math.max(sp.gap, sGap) - sp.gap;
        const delta = Math.min(full, this.localShift(plane, box, maxRight + 1, blockers, S, Math.max(sp.gap, sGap)) ?? full);
        this.recordSpace(this.drawing(plane).makeSpace({ axis: 'x', line: maxRight + 1, delta, anchors: [main.id, probe.parentId], ...this.spaceBand(plane, probe, main) }));
      }
      if (LayoutDebug.on()) LayoutDebug.log(`[place] ${id} after ${main.id}: ${S ? `splice before ${S.id}` : 'continuation'} at x=${x} c=${c}`);
      this.placeAt(plane, id, x, c, size);
      if (!S) (this.continued ??= new Set()).add(id);
      return;
    }
    // new branch: a free row below the anchor's existing branches (the first ones, cheapest connection)
    const x = right(main.bounds) + sp.gap;
    // the anchor's existing branches in the new node's own frame (a branch leaving into another lane does not count)
    const below = succShapes.filter((s) => cy(s.bounds) >= cy(main.bounds) - sp.rowTol && frameOf(plane, s) === frame);
    const base = Math.max(cy(main.bounds), ...below.map((s) => cy(s.bounds)));
    const floor = Math.max(bottom(main.bounds), ...below.map((s) => cy(s.bounds)));
    const extent = this.chainExtent(plane, id, pending, sp.gap);
    const cands = this.rowCandidates(plane, probe, frame, x, size, extent, base + sp.row, sp.row, floor, exclude, 0, main, cx(main.bounds));
    // rows above the anchor when it has no branch above it yet (they win only when every row below crosses a line)
    if (!succShapes.some((s) => cy(s.bounds) < cy(main.bounds) - sp.rowTol && frameOf(plane, s) === frame)) cands.push(...this.rowsAbove(plane, probe, frame, main, x, size, extent, cy(main.bounds) - sp.row, sp.row, exclude, TOP_ROW));
    this.placeCand(plane, id, probe, this.cheapest(id, plane, main, kind, cands), main);
  }

  /**
   * Up to two free rows at or above `startCy` for a box at `x`, inside the
   * frame's interior, costing `penalty` and more for each row further up. When
   * the first row sticks out of the frame at the top, room is made at the top
   * of the frame first (an `insert` at its top border; it costs like an opened
   * row). `top`: a boundary event's spot on the host's top border (moved down
   * with the room).
   */
  private rowsAbove(plane: Plane, probe: Probe, frame: DShape | undefined, anchor: DShape, x: number, size: { width: number; height: number }, extent: number, startCy: number, step: number, exclude: ReadonlySet<string>, penalty: number, top?: Box): Cand[] {
    const inner = frame ? frameInterior(frame, 15) : undefined;
    const out: Cand[] = [];
    this.freeRows(plane, frame, x, size.width, size.height, startCy, step, exclude, 2, extent, true).forEach((r, k) => {
      if (inner && r.c + size.height / 2 > bottom(inner)) return;
      if (!inner || r.c - size.height / 2 >= inner.y) {
        out.push({ x, c: r.c, size, extent, penalty: penalty + 60 * k + (r.onLine ? 700 : 0), ...(top ? { top } : {}) });
        return;
      }
      // the first row above sticks out of the frame at the top: room at the top of the frame first (like `place
      // --side top`: everything in it moves down, it grows), costing like an opened row
      if (k || Math.abs(r.c - startCy) > 0.5) return;
      const delta = Math.ceil(inner.y - (r.c - size.height / 2));
      const band = this.spaceBand(plane, probe, anchor);
      const insert: Shift = { line: frame!.bounds.y + 1, delta, ...band };
      const moving = [...plane.shapes.values()].filter((s) => isLeaf(s) && s.bounds.y >= insert.line && (!band.within || (s.bounds.x < right(band.within) && right(s.bounds) > band.within.x))).length;
      const shifted = top ? { ...top, y: top.y + delta } : undefined;
      out.push({ x, c: r.c + delta, size, extent, insert, penalty: penalty + OPEN_ROW + OPEN_PER_SHAPE * Math.min(OPEN_MAX_SHAPES, moving) + delta * 0.2 + (r.onLine ? 700 : 0), ...(shifted ? { top: shifted } : {}) });
    });
    return out;
  }

  /**
   * The spot on the host's top border nearest the boundary event's column that
   * no other boundary event and no docking connection takes (like `place
   * --side top`), or undefined.
   */
  private topSpot(plane: Plane, event: DShape, host: DShape): Box | undefined {
    const hb = host.bounds;
    const size = { width: event.bounds.width, height: event.bounds.height };
    const y = Math.round(hb.y - size.height / 2);
    const others = boundariesOf(plane, host.id).filter((b) => b.id !== event.id).map((b) => b.bounds);
    const docks: Point[] = [];
    for (const e of plane.edges.values()) {
      if (e.points.length < 2 || e.sourceId === event.id) continue;
      if (e.sourceId === host.id) docks.push(e.points[0]!);
      if (e.targetId === host.id) docks.push(e.points[e.points.length - 1]!);
    }
    const labels = [...plane.shapes.values(), ...plane.edges.values()].filter((o) => o.id !== host.id && o.id !== event.id && o.label).map((o) => o.label!);
    // a line through the spot (a rework line right above the host): the event would sit on it, and the line would be
    // routed again around the event (mostly with a crossing); the event's own flow does not count
    const lines = [...plane.edges.values()].filter((e) => e.sourceId !== event.id).map((e) => e.points);
    const onLine = (b: Box): boolean => lines.some((pts) => pathHits(pts, b, -4));
    const free = (b: Box): boolean => !others.some((o) => overlaps(o, b, 4)) && !docks.some((p) => p.x > b.x - 4 && p.x < right(b) + 4 && p.y > b.y - 4 && p.y < bottom(b) + 4) && !labels.some((l) => overlaps(l, b, 2)) && !onLine(b);
    const lo = hb.x + size.width / 2;
    const hi = right(hb) - size.width / 2;
    const start = Math.min(hi, Math.max(lo, cx(event.bounds)));
    for (let d = 0; d <= hb.width; d += 4) {
      for (const c of d ? [start + d, start - d] : [start]) {
        const b = { x: Math.round(c - size.width / 2), y, ...size };
        if (c >= lo - 0.5 && c <= hi + 0.5 && free(b)) return b;
      }
    }
    return undefined;
  }

  /**
   * Rows above the host for the first node of a boundary event's path (the
   * event moves to the host's top border when one wins, seatOnTop): only for
   * an event on the bottom border placed by the CLI (in this run, or by an
   * earlier command where placeBoundary puts it; one drawn by hand elsewhere
   * keeps its border) whose path starts with this node (no other drawn
   * successor) and a free spot on the top border (topSpot: no other event,
   * docking connection, label or line there). They cost TOP_ROW more than a
   * row below (room at the top of the frame like an opened row on top), so a
   * clean row below wins and a row below that crosses a line loses.
   */
  private topCandidates(plane: Plane, id: string, probe: Probe, event: DShape, host: DShape, frame: DShape | undefined, size: { width: number; height: number }, extent: number, exclude: ReadonlySet<string>): Cand[] {
    if (attachedSide(event.bounds, host.bounds) !== 'bottom') return [];
    // an event drawn by hand keeps the border it was drawn on (the drawing's convention): only one placed in this
    // run, or by an earlier command (it sits where placeBoundary puts a new event), goes to the top border
    if (!this.placed.has(event.id)) {
      const spot = this.boundarySpot(plane, host, { width: event.bounds.width, height: event.bounds.height }, event.id);
      if (Math.abs(spot.x - event.bounds.x) > 1 || Math.abs(spot.y - event.bounds.y) > 1) return [];
    }
    if (successors(this.sem, event.id).some((n) => n !== id && plane.shapes.has(n))) return [];
    const spot = this.topSpot(plane, event, host);
    if (!spot) return [];
    const sp = this.spacingFor(plane);
    const xs = [right(host.bounds) + sp.gap, Math.round(cx(spot) - size.width / 2)];
    return xs.flatMap((x, xi) => this.rowsAbove(plane, probe, frame, event, x, size, extent, cy(host.bounds) - sp.row, sp.row, exclude, TOP_ROW + 40 * xi, spot));
  }

  /** Moves a boundary event to its spot on the host's top border (its path is placed above the host next). */
  private seatOnTop(plane: Plane, event: DShape, spot: Box): void {
    const moved = this.drawing(plane).shift(event.id, spot.x - event.bounds.x, spot.y - event.bounds.y);
    for (const m of moved) if (!this.placed.has(m)) this.moved.add(m);
    // its label is placed again once its path is drawn (layout/IncrementalLayout.ts labels)
    if (event.label) (this.relabel ??= new Set()).add(event.id);
    this.notes.push(`${event.id} moved to the top border of ${event.hostId}: its path runs above it (below, it would cross a line or take more room)`);
  }

  private placeBefore(plane: Plane, id: string, succ: DShape): void {
    const sp = this.spacingFor(plane);
    const size = this.sizeFor(plane, id);
    const probe = this.probeOf(plane, id);
    const frame = frameOf(plane, probe);
    const exclude = new Set([id, ...this.homeGroups(plane, [succ])]);
    const inner = frame ? frameInterior(frame, 10) : undefined;
    const x = succ.bounds.x - sp.gap - size.width;
    const obs = this.obstacles(plane, frame, exclude);
    if (!inner || x >= inner.x) {
      for (let k = 0; k < 3; k++) {
        const c = cy(succ.bounds) + k * sp.row;
        const box = { x, y: c - size.height / 2, ...size };
        if (this.isFree(box, obs)) {
          this.placeAt(plane, id, x, this.intoOwnLane(plane, probe, x, c, size, [], succ), size);
          return;
        }
      }
    }
    this.recordSpace(this.drawing(plane).makeSpace({ axis: 'x', line: succ.bounds.x - 0.5, delta: size.width + sp.gap, anchors: [succ.id, probe.parentId], ...this.spaceBand(plane, probe, succ) }));
    const c = this.intoOwnLane(plane, probe, succ.bounds.x - sp.gap - size.width, cy(succ.bounds), size, [], succ);
    this.placeAt(plane, id, succ.bounds.x - sp.gap - size.width, c, size);
  }

  /** Below the content of the node's frame, at the frame's first column. */
  private placeUnconnected(plane: Plane, id: string): DShape {
    const sp = this.spacingFor(plane);
    const size = this.sizeFor(plane, id);
    const probe = this.probeOf(plane, id);
    const frame = frameOf(plane, probe);
    const exclude = new Set([id]);
    const members = [...plane.shapes.values()].filter((s) => s.id !== id && isLeaf(s) && s.kind !== 'boundary' && s.kind !== 'annotation' && s.kind !== 'data' && this.within(plane, s, frame) && s !== frame);
    const inner = frame ? frameInterior(frame, frame.kind === 'subProcess' ? 20 : 15) : undefined;
    let x: number;
    let c: number;
    if (members.length) {
      x = Math.min(...members.map((s) => s.bounds.x));
      const below = this.contentBottom(plane, frame, exclude) ?? Math.max(...members.map((s) => bottom(s.bounds)));
      c = below + Math.max(30, sp.row - 80) + size.height / 2;
      c = this.freeRows(plane, frame, x, size.width, size.height, c, sp.row / 2, exclude, 1)[0]!.c;
    } else if (inner) {
      x = inner.x + (frame!.kind === 'subProcess' ? 10 : 20);
      c = frame!.kind === 'subProcess' ? inner.y + 20 + size.height / 2 : cy(inner);
    } else {
      const all = [...plane.shapes.values()].filter((s) => s.id !== id);
      const box = all.length ? all.reduce((b, s) => ({ x: Math.min(b.x, s.bounds.x), y: Math.max(b.y, bottom(s.bounds)) }), { x: Infinity, y: -Infinity }) : { x: 160, y: 40 };
      x = Number.isFinite(box.x) ? box.x : 160;
      c = (Number.isFinite(box.y) ? box.y : 40) + 60 + size.height / 2;
    }
    return this.placeAt(plane, id, x, c, size);
  }

  /** Whether `to` follows `from` along sequence flows (at most 500 nodes visited). */
  private leadsTo(from: string, to: string): boolean {
    const seen = new Set([from]);
    const queue = [from];
    while (queue.length && seen.size <= 500) {
      for (const n of successors(this.sem, queue.shift()!)) {
        if (n === to) return true;
        if (seen.has(n)) continue;
        seen.add(n);
        queue.push(n);
      }
    }
    return false;
  }

  /**
   * A join placed in this run (a merge an earlier op of the batch spliced)
   * whose last predecessor `id` was just placed, and that a flow from one of
   * its predecessors would now enter backwards (no loop return), is placed
   * again right of its rightmost predecessor, before its one successor S: what
   * the `connect` into it does as a single command (layout/IncrementalLayout.ts
   * pullJoins). Same conditions: a gateway with two or more incoming flows and
   * one outgoing flow to S, its predecessors and S in its pool / sub-process,
   * S right of the predecessors.
   */
  private pullPlacedJoins(plane: Plane, id: string, pending: ReadonlySet<string>): void {
    for (const jid of successors(this.sem, id)) {
      const join = plane.shapes.get(jid);
      if (!join || !this.placed.has(jid) || pending.has(jid) || !is(join.el, 'bpmn:Gateway')) continue;
      const preds = predecessors(this.sem, jid).map((p) => plane.shapes.get(p));
      const outs = successors(this.sem, jid);
      const S = outs.length === 1 ? plane.shapes.get(outs[0]!) : undefined;
      if (preds.length < 2 || !S || !preds.every((p): p is DShape => !!p)) continue;
      const sameFrame = (s: DShape): boolean => s.poolId === join.poolId && s.parentId === join.parentId;
      if (!preds.every(sameFrame) || !sameFrame(S) || S.bounds.x <= Math.max(...preds.map((p) => right(p.bounds)))) continue;
      if (!preds.some((p) => cx(join.bounds) < p.bounds.x && !this.leadsTo(jid, p.id))) continue;
      plane.shapes.delete(jid);
      (this.joins ??= new Map()).set(jid, S.id);
      if (LayoutDebug.on()) LayoutDebug.log(`[join] ${jid}: a flow from ${preds.map((p) => p.id).join(', ')} would enter it backwards: placed again before ${S.id}`);
      this.placeAfter(plane, jid, preds, pending);
    }
  }

  /**
   * Gives every flow node in `ids` a shape, in dependency order (see module
   * contract). Ids whose plane does not exist are skipped and returned.
   */
  placeFlowNodes(ids: string[]): string[] {
    const pending = new Set(ids);
    const skipped: string[] = [];
    const shapeOn = (plane: Plane, id: string): DShape | undefined => plane.shapes.get(id);
    // exception paths: the new nodes after a new boundary event; they wait for the normal flow's new nodes
    // (like single commands that add the normal flow first), so the two do not cross each other
    const exception = new Set<string>();
    const walk = ids.filter((id) => is(this.sem.byId.get(id), 'bpmn:BoundaryEvent'));
    while (walk.length) {
      for (const n of successors(this.sem, walk.shift()!)) {
        if (!pending.has(n) || exception.has(n)) continue;
        exception.add(n);
        walk.push(n);
      }
    }
    let last: { plane: Plane; id: string } | undefined;
    while (pending.size) {
      // a relocated node brings its boundary events and sub-process content back with it (commit): never place them twice
      for (const id of pending) if (this.planes.some((p) => p.shapes.has(id))) pending.delete(id);
      if (!pending.size) break;
      // more nodes follow: the one placed last gets its flows now (afterNode), so the next placement sees them
      if (last) this.hooks.afterNode?.(last.plane, last.id);
      last = undefined;
      let chosen: { id: string; plane: Plane; mode: 'boundary' | 'after' | 'exception' | 'before' | 'free'; preds?: DShape[]; succ?: DShape } | undefined;
      // the normal flow first, then boundary events, then their exception paths
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
            const preds = predecessors(this.sem, id).map((p) => shapeOn(plane, p)).filter((p): p is DShape => !!p);
            if (preds.length) chosen = { id, plane, mode, preds };
          } else if (mode === 'before') {
            const succ = successors(this.sem, id).map((p) => shapeOn(plane, p)).find((p): p is DShape => !!p);
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
        if (!this.placeBoundary(chosen.plane, chosen.id)) this.placeUnconnected(chosen.plane, chosen.id);
      } else if (chosen.mode === 'after' || chosen.mode === 'exception') this.placeAfter(chosen.plane, chosen.id, chosen.preds!, pending);
      else if (chosen.mode === 'before') this.placeBefore(chosen.plane, chosen.id, chosen.succ!);
      else if (is(this.sem.byId.get(chosen.id)!, 'bpmn:BoundaryEvent') && this.placeBoundary(chosen.plane, chosen.id)) {
        /* host placed meanwhile */
      } else this.placeUnconnected(chosen.plane, chosen.id);
      this.pullPlacedJoins(chosen.plane, chosen.id, pending);
      last = { plane: chosen.plane, id: chosen.id };
    }
    return skipped;
  }

  /** Elements an artifact is connected to (associations, data associations), in model order. */
  private artifactAnchors(id: string): string[] {
    const out: string[] = [];
    const el = this.sem.byId.get(id);
    if (!el) return out;
    for (const other of this.sem.byId.values()) {
      if (is(other, 'bpmn:Association')) {
        const s = idOf(raw(other, 'sourceRef'));
        const t = idOf(raw(other, 'targetRef'));
        if (s === id && t) out.push(t);
        else if (t === id && s) out.push(s);
      } else if (is(other, 'bpmn:DataInputAssociation')) {
        if (rawList(other, 'sourceRef').some((r) => idOf(r) === id) && idOf(other.$parent)) out.push(idOf(other.$parent)!);
      } else if (is(other, 'bpmn:DataOutputAssociation')) {
        if (idOf(raw(other, 'targetRef')) === id && idOf(other.$parent)) out.push(idOf(other.$parent)!);
      }
    }
    return out;
  }

  /** Text annotation above-right, data object / store below-right of the element it belongs to. */
  placeArtifact(id: string): boolean {
    const plane = this.hooks.planeFor(id);
    if (!plane) return false;
    const el = this.sem.byId.get(id)!;
    const size = this.sizeFor(plane, id);
    const anchor = this.artifactAnchors(id)
      .map((a) => plane.shapes.get(a))
      .find((s): s is DShape => !!s);
    if (!anchor) {
      this.placeUnconnected(plane, id);
      return true;
    }
    const probe = this.probeOf(plane, id);
    const frame = frameOf(plane, probe);
    const obs = this.obstacles(plane, frame, new Set([id, ...this.homeGroups(plane, [anchor])]));
    const segs = this.edgeBoxes(plane);
    const a = this.drawing(plane).unitBox(anchor);
    const annotation = is(el, 'bpmn:TextAnnotation');
    const candidates: Box[] = [];
    const steps = [0, 1, 2, 3, 4];
    for (const k of steps) {
      if (annotation) {
        candidates.push({ x: right(a) + 20 + k * 30, y: a.y - 30 - size.height - k * 20, ...size });
        candidates.push({ x: a.x + a.width / 2 + k * 40, y: a.y - 40 - size.height - k * 30, ...size });
      } else {
        candidates.push({ x: right(a) + 10 + k * (size.width + 20), y: bottom(a) + 30, ...size });
        candidates.push({ x: right(a) + 10, y: bottom(a) + 30 + k * (size.height + 20), ...size });
      }
    }
    if (annotation) for (const k of steps) candidates.push({ x: right(a) + 30 + k * (size.width + 20), y: a.y - size.height / 2, ...size }, { x: right(a) + 20, y: bottom(a) + 30 + k * (size.height + 20), ...size });
    const inner = frame ? frameInterior(frame, 5) : undefined;
    const ok = (b: Box): boolean => this.isFree(b, obs, 15) && !segs.some((s) => overlaps(s, b, 2)) && (!inner || (b.x >= inner.x && b.y >= inner.y));
    const box = candidates.find(ok) ?? candidates.find((b) => this.isFree(b, obs, 10) && (!inner || (b.x >= inner.x && b.y >= inner.y))) ?? candidates[0]!;
    const s = this.newShape(plane, id, { ...box, x: Math.round(box.x), y: Math.round(box.y) });
    this.commit(plane, s);
    return true;
  }
}
