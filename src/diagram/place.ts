/**
 * Placement of elements that have no DI yet, into a drawing that is kept.
 *
 * CONTRACT
 *  placeFlowNodes(ctx, ids) gives every flow node in `ids` a shape, in
 *  dependency order: boundary events whose host has a shape first, then nodes
 *  with a placed predecessor, then nodes with a placed successor, then the
 *  rest (chains of new nodes are placed one after the other). The rules
 *  (gap = median horizontal gap between connected neighbours of the plane,
 *  clamped 40..100, fallback 60; row = median row spacing, clamped 80..150):
 *   - splice (the flow P->S was split by N): x = P.right + gap, centred on
 *     S's row when S is in P's row band (or P is a branching node), else on
 *     P's row; S's row in another lane than N's own is replaced by a free
 *     row of N's lane (rowInLane: N's lane never stretches over to S's row);
 *     only when that spot is taken: space tool at P.right + 1 by
 *     N.width + gap within P's pool (inside an expanded sub-process: in
 *     frame mode, so the sub-process never grows over foreign shapes, see
 *     space.ts; the same for every space-tool run placement makes there)
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
 *     row below the host
 *   Branch and exception rows are chosen among the first free rows (and the
 *   first row opened with the space tool when it is taken) by a trial route
 *   from the anchor (connectionCost: cut shapes, crossings, labels hit, bends,
 *   length) plus penalties for lower rows, rows on existing lines and the
 *   shapes a frame growth or opened row would move.
 *   - unconnected: below the content of its frame (expanded sub-process, lane,
 *     pool or plane), left-aligned at the frame's first column; only the
 *     frame's own content counts (its members, what is drawn in it, the
 *     labels of its connections), never a label or group elsewhere on the
 *     plane. The same holds for a new row below a lane's content (rowInLane)
 *  Obstacles are the frame's content plus whatever is drawn inside the frame
 *  without belonging to it (annotations and data in a lane, collaboration
 *  annotations in a pool). Groups are obstacles, except a group drawn around
 *  the anchor: the new node may go inside it (incremental.ts grows the group),
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
 *  bottom (frames grow, see space.ts fitInFrame).
 *
 *  changeLane(ctx, id) moves an existing node into its (new) lane: same x,
 *  the free row of the target lane band preferred for its neighbours, else a
 *  new row below (the lane grows).
 *
 *  placeArtifact(ctx, id): text annotation above-right of the element it is
 *  associated with, data object / store below-right of the activity it is
 *  connected to (unconnected: like an unconnected node).
 */
import { layoutDebug, layoutDebugOn } from '../debug.js';
import { annotationSize } from '../layout/place.js';
import { SIZES } from '../layout/types.js';
import { is, type El } from '../model.js';
import { bottom, clamp, cx, cy, median, overlaps, pathHits, right, segmentHits, type Box, type Point } from './geom.js';
import { boundariesOf, frameOf, frameInterior, idOf, inFrame, isLeaf, isSubProcess, poolOf, raw, rawList, shapeKind, type DEdge, type DShape, type Plane, type Semantics } from './plane.js';
import { routingLines } from './reroute.js';
import { attachedSide, defaultSides, routeOrthogonal, type ShapeKind } from './router.js';
import { fitInFrame, makeSpace, shiftShape, unitBox } from './space.js';

export interface Spacing {
  /** horizontal gap between connected neighbours */
  gap: number;
  /** vertical distance between row centres */
  row: number;
  /** centres closer than this are on the same row */
  rowTol: number;
}

export interface Reuse {
  shape: DShape;
  boundaries: DShape[];
  /** plane the node was drawn on */
  from: Plane;
  /** content of an expanded sub-process (moves rigidly with it) */
  content?: { shapes: DShape[]; edges: DEdge[] };
}

export interface PlaceCtx {
  planes: Plane[];
  sem: Semantics;
  spacing: Map<Plane, Spacing>;
  /** ids that got a new shape in this run */
  placed: Set<string>;
  /** pre-existing shapes moved in this run */
  moved: Set<string>;
  /** sequence flows whose source / target changed: their ids before the ops */
  oldSource: Map<string, string>;
  oldTarget: Map<string, string>;
  /** shapes of relocated nodes (their DI is reused), their boundary events and expanded content */
  reuse: Map<string, Reuse>;
  /** called after a shape was placed (blocks add their content here) */
  afterPlace?: (plane: Plane, s: DShape) => void;
  /** fixed sizes for blocks laid out elsewhere (new expanded sub-processes, pools) */
  blockSize: Map<string, { width: number; height: number }>;
  /** new sub-processes drawn collapsed (all others are expanded) */
  collapsed: ReadonlySet<string>;
  /** resolves the plane an element belongs on (creating it when needed) */
  planeFor(id: string): Plane | undefined;
  notes: string[];
}

/* ------------------------------------------------------------------ */
/* spacing                                                              */
/* ------------------------------------------------------------------ */

/** Gap and row spacing of a plane, measured on its sequence flows. */
export function spacingOf(plane: Plane): Spacing {
  const gaps: number[] = [];
  const rows: number[] = [];
  for (const e of plane.edges.values()) {
    if (e.kind !== 'sequenceFlow' || !e.sourceId || !e.targetId) continue;
    const s = plane.shapes.get(e.sourceId);
    const t = plane.shapes.get(e.targetId);
    if (!s || !t || s.kind === 'boundary' || s.container || t.container) continue;
    const dy = Math.abs(cy(s.bounds) - cy(t.bounds));
    if (dy <= 5) {
      const g = t.bounds.x - right(s.bounds);
      if (g > 0) gaps.push(g);
    } else if (dy >= 30) rows.push(dy);
  }
  const gap = Math.round(clamp(median(gaps) ?? 60, 40, 100));
  const row = Math.round(clamp(median(rows) ?? 140, 80, 150));
  return { gap, row, rowTol: Math.max(5, row / 4) };
}

function spacing(ctx: PlaceCtx, plane: Plane): Spacing {
  let s = ctx.spacing.get(plane);
  if (!s) {
    s = spacingOf(plane);
    ctx.spacing.set(plane, s);
  }
  return s;
}

/* ------------------------------------------------------------------ */
/* semantic neighbourhood                                               */
/* ------------------------------------------------------------------ */

function flows(el: El | undefined, prop: 'incoming' | 'outgoing'): El[] {
  return rawList(el, prop).filter((f) => is(f, 'bpmn:SequenceFlow'));
}

export function predecessors(sem: Semantics, id: string): string[] {
  return flows(sem.byId.get(id), 'incoming')
    .map((f) => idOf(raw(f, 'sourceRef')))
    .filter((x): x is string => !!x);
}

export function successors(sem: Semantics, id: string): string[] {
  return flows(sem.byId.get(id), 'outgoing')
    .map((f) => idOf(raw(f, 'targetRef')))
    .filter((x): x is string => !!x);
}

/* ------------------------------------------------------------------ */
/* shapes                                                               */
/* ------------------------------------------------------------------ */

function defaultSize(el: El): { width: number; height: number } {
  if (is(el, 'bpmn:Event')) return { ...SIZES.event };
  if (is(el, 'bpmn:Gateway')) return { ...SIZES.gateway };
  if (is(el, 'bpmn:DataObjectReference')) return { ...SIZES.dataObject };
  if (is(el, 'bpmn:DataStoreReference')) return { ...SIZES.dataStore };
  if (is(el, 'bpmn:TextAnnotation')) return annotationSize(raw<string>(el, 'text'));
  return { ...SIZES.task };
}

/** Size of a new shape: the median of its kind on the plane, else the engine default. */
export function sizeFor(ctx: PlaceCtx, plane: Plane, id: string): { width: number; height: number } {
  const block = ctx.blockSize.get(id);
  if (block) return block;
  // a relocated node keeps its size (an expanded sub-process its content too)
  const reused = ctx.reuse.get(id)?.shape.bounds;
  if (reused) return { width: reused.width, height: reused.height };
  const el = ctx.sem.byId.get(id)!;
  const kind = shapeKind(el);
  if (kind === 'subProcess' && expandedByDefault(ctx, id)) return { width: 350, height: 200 };
  if (kind === 'annotation') return defaultSize(el);
  // events and boundary events share a size, so do tasks and collapsed sub-processes
  const family = (k: ShapeKind): string => (k === 'boundary' ? 'event' : k === 'subProcess' ? 'task' : k);
  const sameKind = (s: DShape): boolean => !s.container && family(s.kind) === family(kind) && (kind !== 'data' || s.el.$type === el.$type);
  const peers = [...plane.shapes.values()].filter(sameKind);
  const w = median(peers.map((s) => s.bounds.width));
  const h = median(peers.map((s) => s.bounds.height));
  const d = defaultSize(el);
  if (w === undefined || h === undefined) return d;
  // stay within a sensible range of the default (hand drawings may contain one huge task)
  return { width: Math.round(clamp(w, d.width * 0.6, d.width * 1.6)), height: Math.round(clamp(h, d.height * 0.6, d.height * 1.6)) };
}

/** New sub-processes are expanded unless a collapse was requested. */
function expandedByDefault(ctx: PlaceCtx, id: string): boolean {
  return !ctx.collapsed.has(id);
}

/** Creates the DShape of a new element (membership from the semantic model). */
export function newShape(ctx: PlaceCtx, plane: Plane, id: string, bounds: Box): DShape {
  const reuse = ctx.reuse.get(id);
  const el = ctx.sem.byId.get(id)!;
  const kind = shapeKind(el);
  const expanded = kind === 'subProcess' ? (reuse ? reuse.shape.expanded === true : expandedByDefault(ctx, id) || ctx.blockSize.has(id)) : undefined;
  const s: DShape = { id, el, bounds, kind, container: kind === 'participant' || kind === 'lane' || (kind === 'subProcess' && expanded === true) };
  if (reuse?.shape.di) s.di = reuse.shape.di;
  // a BPMNShape without valid bounds gets its bounds now (one DI per element, its colours kept)
  else if (!reuse) {
    const di = ctx.planes.map((p) => p.unbounded?.get(id)).find((x) => !!x);
    if (di) s.di = di;
  }
  if (expanded !== undefined) s.expanded = expanded;
  if (kind === 'boundary') {
    const host = idOf(raw(el, 'attachedToRef'));
    if (host) s.hostId = host;
  }
  const lane = kind === 'lane' ? ctx.sem.laneParent.get(id) : ctx.sem.laneOf.get(id);
  if (lane) s.laneId = lane;
  const pool = poolOf(ctx.sem, id);
  if (pool) s.poolId = pool;
  const scope = ctx.sem.scopeOf.get(id);
  const sid = idOf(scope);
  if (scope && sid && isSubProcess(scope) && plane.shapes.get(sid)?.expanded) s.parentId = sid;
  if (reuse?.shape.label) {
    const old = reuse.shape.bounds;
    s.label = { ...reuse.shape.label, x: reuse.shape.label.x + bounds.x - old.x, y: reuse.shape.label.y + bounds.y - old.y };
  }
  return s;
}

/** Adds a placed shape to the plane, brings reused boundary events along and fits it into its frame. */
function commit(ctx: PlaceCtx, plane: Plane, s: DShape): void {
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
  ctx.placed.add(s.id);
  const reuse = ctx.reuse.get(s.id);
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
      ctx.moved.add(b.id);
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
    ctx.reuse.delete(s.id);
  }
  ctx.afterPlace?.(plane, s);
  const r = fitInFrame(plane, s.id, 15);
  r.moved.forEach((x) => ctx.moved.add(x));
  if (!reuse && s.kind !== 'boundary') reattachBoundaries(ctx, plane, s);
}

/** The centre of a boundary event lies on its host's border (a few px tolerance). */
function onBorder(event: Box, host: Box, tol = 6): boolean {
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
function reattachBoundaries(ctx: PlaceCtx, plane: Plane, host: DShape): void {
  for (const b of boundariesOf(plane, host.id)) {
    if (onBorder(b.bounds, host.bounds)) continue;
    plane.shapes.delete(b.id);
    ctx.reuse.set(b.id, { shape: b, boundaries: [], from: plane });
    if (placeBoundary(ctx, plane, b.id)) {
      ctx.placed.delete(b.id);
      ctx.moved.add(b.id);
    } else {
      ctx.reuse.delete(b.id);
      plane.shapes.set(b.id, b);
    }
  }
}

/* ------------------------------------------------------------------ */
/* free space                                                           */
/* ------------------------------------------------------------------ */

/** True when `frame` is `s`'s frame or an ancestor of it. */
const within = (plane: Plane, s: DShape, frame: DShape | undefined): boolean => inFrame(plane, s, frame);

/**
 * Obstacles for a new shape in `frame`: its content (leaf shapes with their
 * boundary events, expanded sub-processes, labels), and whatever else is
 * drawn inside it without belonging to it semantically (an annotation or data
 * object in a lane, a collaboration-level annotation in a pool). Groups are
 * obstacles too, except the ones in `exclude` (the groups the anchor sits in).
 * `plain` false: no groups and no connection labels (contentBottom adds the
 * ones inside the frame).
 */
function obstacles(plane: Plane, frame: DShape | undefined, exclude: ReadonlySet<string>, plain = true): { boxes: Box[]; labels: Box[] } {
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
    const member = within(plane, s, frame);
    const drawnIn = !member && !!frame && solid && overlaps(s.bounds, frame.bounds) && !inFrame(plane, frame, s);
    if (!member && !drawnIn) {
      if (frame && s.label && overlaps(s.label, frame.bounds)) labels.push(s.label);
      continue;
    }
    if (solid) boxes.push(isLeaf(s) && !s.hostId ? unitBox(plane, s) : s.bounds);
    if (s.label) labels.push(s.label);
  }
  if (plain) for (const e of plane.edges.values()) if (e.label) labels.push(e.label);
  return { boxes, labels };
}

/** Groups drawn around one of the anchors: a node placed next to its anchor may go inside them (they grow). */
function homeGroups(plane: Plane, anchors: ReadonlyArray<DShape | undefined>): string[] {
  const out: string[] = [];
  for (const g of plane.shapes.values()) {
    if (g.kind !== 'group') continue;
    if (anchors.some((a) => !!a && cx(a.bounds) > g.bounds.x && cx(a.bounds) < right(g.bounds) && cy(a.bounds) > g.bounds.y && cy(a.bounds) < bottom(g.bounds))) out.push(g.id);
  }
  return out;
}

function isFree(box: Box, obs: { boxes: Box[]; labels: Box[] }, clearance = 20): boolean {
  return !obs.boxes.some((b) => overlaps(b, box, clearance)) && !obs.labels.some((l) => overlaps(l, box, 4));
}

/**
 * Where a space-tool run for a node goes: inside its expanded sub-process
 * (frame mode: the sub-process never grows over foreign shapes, space.ts),
 * else within its pool.
 */
function spaceBand(plane: Plane, s: Pick<DShape, 'parentId' | 'poolId'>, anchor?: DShape): { within?: Box; frame?: string } {
  const sub = s.parentId ? plane.shapes.get(s.parentId) : undefined;
  if (sub) return { within: { ...sub.bounds }, frame: sub.id };
  const pool = s.poolId ? plane.shapes.get(s.poolId) : undefined;
  if (pool) return { within: { ...pool.bounds } };
  // no pool: a group drawn around the anchor confines the space tool like a pool would (hand drawings in columns)
  const group = anchor ? homeGroups(plane, [anchor]).map((id) => plane.shapes.get(id)!).sort((a, b) => a.bounds.width * a.bounds.height - b.bounds.width * b.bounds.height)[0] : undefined;
  return group ? { within: { ...group.bounds } } : {};
}

function recordSpace(ctx: PlaceCtx, r: { moved: Set<string> }): void {
  r.moved.forEach((x) => ctx.moved.add(x));
}

/** The centre of `b` lies inside `frame` (the plane: always). */
function centreIn(b: Box, frame: DShape | undefined): boolean {
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
function contentBottom(plane: Plane, frame: DShape | undefined, exclude: ReadonlySet<string>): number | undefined {
  const obs = obstacles(plane, frame, exclude, false);
  const member = (id: string | undefined): boolean => {
    const s = id ? plane.shapes.get(id) : undefined;
    return !!s && s !== frame && within(plane, s, frame);
  };
  const edgeLabels = [...plane.edges.values()].filter((e) => e.label && ((member(e.sourceId) && member(e.targetId)) || centreIn(e.label, frame))).map((e) => e.label!);
  const groups = [...plane.shapes.values()].filter((g) => g.kind === 'group' && !exclude.has(g.id) && centreIn(g.bounds, frame)).map((g) => g.bounds);
  const all = [...obs.boxes, ...obs.labels, ...edgeLabels, ...groups];
  return all.length ? Math.max(...all.map(bottom)) : undefined;
}

/** Thin boxes of all edge segments (to keep new rows off existing lines). */
function edgeBoxes(plane: Plane): Box[] {
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

/** Up to `count` free row centres at or below `startCy` (shape-free; rows on existing lines are flagged). */
function freeRows(plane: Plane, frame: DShape | undefined, x: number, width: number, height: number, startCy: number, step: number, exclude: ReadonlySet<string>, count: number): Array<{ c: number; onLine: boolean }> {
  const obs = obstacles(plane, frame, exclude);
  const segs = edgeBoxes(plane);
  const out: Array<{ c: number; onLine: boolean }> = [];
  for (let k = 0; k < 40 && out.length < count; k++) {
    const c = startCy + k * step;
    const box = { x, y: c - height / 2, width, height };
    if (!isFree(box, obs)) continue;
    out.push({ c, onLine: segs.some((sg) => overlaps(sg, box, 4)) });
  }
  if (!out.length) out.push({ c: startCy, onLine: false });
  return out;
}

function properCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const o = (p: Point, q: Point, r: Point): number => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  const o1 = o(a, b, c);
  const o2 = o(a, b, d);
  const o3 = o(c, d, a);
  const o4 = o(c, d, b);
  return o1 !== o2 && o3 !== o4 && !!o1 && !!o2 && !!o3 && !!o4;
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
  /** a row opened with the space tool before placing */
  insert?: Shift;
  /** the frame growth placing there causes (fitInFrame), for the cost estimate */
  grow?: Shift;
}

const shiftedBox = (b: Box, sh: Shift | undefined): Box => (sh && b.y >= sh.line ? { ...b, y: b.y + sh.delta } : b);
const shiftedLine = (pts: Point[], sh: Shift | undefined): Point[] => (sh ? pts.map((p) => (p.y >= sh.line ? { x: p.x, y: p.y + sh.delta } : p)) : pts);

/**
 * What connecting `from` to a candidate box would cost: a trial route through
 * the drawing (router.ts), charged for cut shapes, crossed lines, labels hit,
 * bends and length. `shift` approximates a row opened by the space tool.
 */
function connectionCost(plane: Plane, from: DShape, to: Box, toKind: ShapeKind, shift?: Shift): number {
  const host = from.hostId ? plane.shapes.get(from.hostId) : undefined;
  const obstacles: Box[] = [];
  for (const o of plane.shapes.values()) {
    if (o === from || o.kind === 'group') continue;
    if (isLeaf(o) || (o.kind === 'subProcess' && o.container && o.id !== from.parentId)) obstacles.push(shiftedBox(o.bounds, shift));
  }
  const flows = [...plane.edges.values()].map((e) => shiftedLine(e.points, shift)).filter((p) => p.length >= 2);
  const lines = routingLines(plane).map((l) => shiftedLine(l, shift));
  const hostBox = host ? shiftedBox(host.bounds, shift) : undefined;
  const sourceSides = from.kind === 'boundary' && hostBox ? [attachedSide(from.bounds, hostBox)] : defaultSides(from.kind, 'source');
  const pts = routeOrthogonal({ source: from.bounds, target: to, sourceSides, targetSides: defaultSides(toKind, 'target'), obstacles, lines });
  let cost = 0;
  for (let i = 0; i + 1 < pts.length; i++) cost += Math.abs(pts[i + 1]!.x - pts[i]!.x) + Math.abs(pts[i + 1]!.y - pts[i]!.y);
  cost = cost * 0.5 + (pts.length - 2) * 30;
  for (const o of obstacles) if (o !== hostBox && pathHits(pts, o)) cost += 2000;
  for (const line of flows) {
    for (let i = 0; i + 1 < pts.length; i++) {
      for (let j = 0; j + 1 < line.length; j++) if (properCross(pts[i]!, pts[i + 1]!, line[j]!, line[j + 1]!)) cost += 300;
    }
  }
  const labels = [...plane.shapes.values(), ...plane.edges.values()].map((x) => x.label).filter((l): l is Box => !!l);
  for (const l of labels) for (let i = 0; i + 1 < pts.length; i++) if (segmentHits(pts[i]!, pts[i + 1]!, shiftedBox(l, shift), 0)) cost += 60;
  return cost;
}

/** The cheapest candidate position (by connectionCost plus the candidate's penalty). */
function cheapest(plane: Plane, from: DShape, kind: ShapeKind, cands: Cand[]): Cand {
  let best: { cand: Cand; cost: number } | undefined;
  for (const cand of cands) {
    const box = { x: cand.x, y: cand.c - cand.size.height / 2, ...cand.size };
    const cost = connectionCost(plane, from, box, kind, cand.insert ?? cand.grow) + cand.penalty;
    if (layoutDebugOn()) layoutDebug(`[place] from ${from.id} x=${cand.x} c=${cand.c} penalty=${Math.round(cand.penalty)} cost=${Math.round(cost)}${cand.insert ? ' insert' : ''}${cand.grow ? ` grow ${cand.grow.delta}` : ''}`);
    if (!best || cost < best.cost) best = { cand, cost };
  }
  return best?.cand ?? cands[0]!;
}

/**
 * Candidate rows at or below `first` for a box at `x`: the first free rows, and
 * (when the first row is taken) that row opened with the space tool.
 */
function rowCandidates(plane: Plane, probe: Pick<DShape, 'parentId' | 'poolId'>, frame: DShape | undefined, x: number, size: { width: number; height: number }, extent: number, first: number, step: number, floor: number, exclude: ReadonlySet<string>, basePenalty = 0, anchor?: DShape): Cand[] {
  const rows = freeRows(plane, frame, x, size.width + extent, size.height, first, step, exclude, 3);
  const band = spaceBand(plane, probe, anchor);
  const moving = (line: number): number => [...plane.shapes.values()].filter((s) => isLeaf(s) && s.bounds.y >= line && (!band.within || (s.bounds.x < right(band.within) && right(s.bounds) > band.within.x))).length;
  const cands: Cand[] = rows.map((r, k) => {
    const cand: Cand = { x, c: r.c, size, penalty: basePenalty + 60 * k + (r.onLine ? 700 : 0) + Math.max(0, (r.c - first) / step - 1) * 40 };
    // a row below the frame's interior grows the frame: content below it moves away
    if (frame && r.c + size.height / 2 + 15 > bottom(frame.bounds)) {
      const line = bottom(frame.bounds) - 1;
      const delta = Math.ceil(r.c + size.height / 2 + 15 - bottom(frame.bounds));
      cand.grow = { line, delta, ...band };
      cand.penalty += 10 * moving(line) + delta * 0.3;
    }
    return cand;
  });
  if (rows.some((r) => Math.abs(r.c - first) < 1)) return cands;
  const box = { x, y: first - size.height / 2, width: size.width + extent, height: size.height };
  const blockers = obstacles(plane, frame, exclude).boxes.filter((b) => overlaps(b, box, 20));
  if (!blockers.length) return cands;
  const top = Math.min(...blockers.map((b) => b.y));
  if (top <= floor) return cands;
  const insert: Shift = { line: top - 0.5, delta: Math.ceil(bottom(box) + 20 - top), ...band };
  cands.push({ x, c: first, size, penalty: basePenalty + 150 + 10 * moving(insert.line) + insert.delta * 0.3, insert });
  return cands;
}

/** Places at a chosen candidate (opening its row first). */
function placeCand(ctx: PlaceCtx, plane: Plane, id: string, probe: Probe, cand: Cand, anchor: DShape): void {
  if (cand.insert) {
    const { line, delta, within, frame } = cand.insert;
    recordSpace(ctx, makeSpace(plane, { axis: 'y', line, delta, anchors: [anchor.id, probe.parentId], ...(within ? { within } : {}), ...(frame ? { frame } : {}) }));
  }
  placeAt(ctx, plane, id, cand.x, intoOwnLane(ctx, plane, probe, cand.x, cand.c, cand.size, [], anchor), cand.size);
}

/* ------------------------------------------------------------------ */
/* lanes                                                                */
/* ------------------------------------------------------------------ */

/** Row centres used in a lane (clustered node centres), most populated first. */
function laneRows(plane: Plane, lane: DShape, tol: number, exclude: ReadonlySet<string>): number[] {
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
export function rowInLane(ctx: PlaceCtx, plane: Plane, lane: DShape, x: number, width: number, height: number, prefer: number[], exclude: ReadonlySet<string>): number {
  const sp = spacing(ctx, plane);
  const obs = obstacles(plane, lane, exclude);
  const inner = frameInterior(lane, 10);
  const fitsIn = (c: number, b: Box): boolean => c - height / 2 >= b.y - 0.5 && c + height / 2 <= bottom(b) + 0.5;
  const rows = laneRows(plane, lane, sp.rowTol, exclude);
  // the lane's own rows are used as tightly as the drawing uses them; anything else keeps 10 px from the borders
  const candidates = [...prefer.filter((c) => fitsIn(c, inner)), ...rows.filter((c) => fitsIn(c, lane.bounds))];
  if (!rows.length) candidates.push(Math.round(cy(inner)));
  for (const c of candidates) {
    if (isFree({ x, y: c - height / 2, width, height }, obs)) return c;
  }
  const below = contentBottom(plane, lane, exclude);
  return Math.round((below ?? inner.y) + Math.max(30, sp.row - 80) + height / 2);
}

/** Moves an existing node into its (new) lane: same x, a free row of the lane band. */
export function changeLane(ctx: PlaceCtx, plane: Plane, id: string): boolean {
  const s = plane.shapes.get(id);
  const lane = s?.laneId ? plane.shapes.get(s.laneId) : undefined;
  if (!s || !lane) return false;
  const inner = frameInterior(lane, 2);
  const inLane = (): boolean => s.bounds.y >= inner.y && bottom(s.bounds) <= bottom(inner) && s.bounds.x >= lane.bounds.x && right(s.bounds) <= right(lane.bounds);
  if (inLane()) return false;
  const exclude = new Set([id, ...boundariesOf(plane, id).map((b) => b.id)]);
  const neighbours = [...predecessors(ctx.sem, id), ...successors(ctx.sem, id)]
    .map((n) => plane.shapes.get(n))
    .filter((n): n is DShape => !!n && n.laneId === lane.id)
    .map((n) => Math.round(cy(n.bounds)));
  const c = rowInLane(ctx, plane, lane, s.bounds.x, s.bounds.width, s.bounds.height, neighbours, exclude);
  const dy = Math.round(c - s.bounds.height / 2 - s.bounds.y);
  for (const m of shiftShape(plane, id, 0, dy)) ctx.moved.add(m);
  // a row of the lane's own (as close to the border as its shapes sit) needs no growth
  if (!inLane()) recordSpace(ctx, fitInFrame(plane, id, 15));
  return true;
}

/* ------------------------------------------------------------------ */
/* flow nodes                                                           */
/* ------------------------------------------------------------------ */

interface Probe {
  id: string;
  kind: DShape['kind'];
  parentId?: string;
  laneId?: string;
  poolId?: string;
}

function probeOf(ctx: PlaceCtx, plane: Plane, id: string): Probe {
  const s = newShape(ctx, plane, id, { x: 0, y: 0, width: 0, height: 0 });
  return { id, kind: s.kind, ...(s.parentId ? { parentId: s.parentId } : {}), ...(s.laneId ? { laneId: s.laneId } : {}), ...(s.poolId ? { poolId: s.poolId } : {}) };
}

/** Number of new nodes that follow `id` in a simple chain (for the room a branch row needs). */
function chainExtent(ctx: PlaceCtx, plane: Plane, id: string, pending: ReadonlySet<string>, gap: number): number {
  let extent = 0;
  let cur = id;
  for (let i = 0; i < 4; i++) {
    const next = successors(ctx.sem, cur).filter((n) => pending.has(n) && n !== id);
    if (next.length !== 1) break;
    cur = next[0]!;
    extent += sizeFor(ctx, plane, cur).width + gap;
  }
  return extent;
}

/** Places a boundary event on its host's bottom border. */
function placeBoundary(ctx: PlaceCtx, plane: Plane, id: string): boolean {
  const el = ctx.sem.byId.get(id)!;
  const hostId = idOf(raw(el, 'attachedToRef'));
  const host = hostId ? plane.shapes.get(hostId) : undefined;
  if (!host) return false;
  const size = sizeFor(ctx, plane, id);
  const hb = host.bounds;
  const others = boundariesOf(plane, host.id).map((b) => b.bounds);
  const offset = Math.min(SIZES.event.width / 2 + 7, hb.width / 2);
  // the flow leaves a bottom boundary event downwards: keep that lane clear of other labels
  const labels = [...plane.shapes.values()].filter((o) => o.id !== host.id && o.label).map((o) => o.label!);
  const exitClear = (b: Box): boolean => b.y < hb.y || !labels.some((l) => overlaps(l, { x: b.x + b.width / 2 - 2, y: bottom(b), width: 4, height: 40 }));
  // where connections already dock on the host's border (a boundary event there would force them around)
  const docks: Point[] = [];
  for (const e of plane.edges.values()) {
    if (e.points.length < 2) continue;
    if (e.sourceId === host.id) docks.push(e.points[0]!);
    if (e.targetId === host.id) docks.push(e.points[e.points.length - 1]!);
  }
  const onDock = (b: Box): boolean => docks.some((p) => p.x > b.x - 4 && p.x < right(b) + 4 && p.y > b.y - 4 && p.y < bottom(b) + 4);
  let strict = true;
  const free = (b: Box): boolean => !others.some((o) => overlaps(o, b, 4)) && !onDock(b) && (!strict || (exitClear(b) && !labels.some((l) => overlaps(l, b, 2))));
  // bottom border right to left (the corner included), then the top border; first with a clear exit
  let box: Box | undefined;
  for (const [y, clear] of [[bottom(hb) - size.height / 2, true], [bottom(hb) - size.height / 2, false], [hb.y - size.height / 2, false]] as const) {
    strict = clear;
    const centres: number[] = [];
    for (let c = right(hb) - offset; c >= hb.x + size.width / 2 - 0.5; c -= 4) centres.push(c);
    for (let c = right(hb) - offset + 4; c <= right(hb); c += 4) centres.push(c);
    for (const c of centres) {
      const cand = { x: Math.round(c - size.width / 2), y: Math.round(y), ...size };
      if (free(cand)) {
        box = cand;
        break;
      }
    }
    if (box) break;
  }
  box ??= { x: Math.round(right(hb) - offset - size.width / 2), y: Math.round(bottom(hb) - size.height / 2), ...size };
  if (box.y > hb.y) makeRoomBelow(ctx, plane, host, box);
  commit(ctx, plane, newShape(ctx, plane, id, box));
  return true;
}

/**
 * A boundary event on the bottom border needs room below the host for its
 * outgoing flow: shapes right below it are pushed down (space tool).
 */
function makeRoomBelow(ctx: PlaceCtx, plane: Plane, host: DShape, event: Box): void {
  const zone = { x: event.x - 10, y: bottom(host.bounds), width: event.width + 20, height: event.height / 2 + 35 };
  const own = new Set([host.id, ...boundariesOf(plane, host.id).map((b) => b.id)]);
  const blockers = [...plane.shapes.values()].filter((o) => !own.has(o.id) && (isLeaf(o) || (o.kind === 'subProcess' && o.container && o.id !== host.parentId)) && overlaps(o.bounds, zone));
  if (!blockers.length) return;
  const top = Math.min(...blockers.map((b) => b.bounds.y));
  if (top < bottom(host.bounds) - 0.5) return;
  recordSpace(ctx, makeSpace(plane, { axis: 'y', line: top - 0.5, delta: Math.ceil(bottom(zone) + 10 - top), anchors: [host.id], ...spaceBand(plane, host, host) }));
}

/** The successor S of a spliced node N (the flow into N ended at S before the ops). */
function spliceTarget(ctx: PlaceCtx, id: string, pred: string): string | undefined {
  const el = ctx.sem.byId.get(id);
  const succ = new Set(successors(ctx.sem, id));
  for (const f of flows(el, 'incoming')) {
    const fid = idOf(f);
    if (!fid || idOf(raw(f, 'sourceRef')) !== pred) continue;
    const old = ctx.oldTarget.get(fid);
    if (old && old !== id && succ.has(old)) return old;
  }
  for (const f of flows(el, 'outgoing')) {
    const fid = idOf(f);
    const target = idOf(raw(f, 'targetRef'));
    if (!fid || !target) continue;
    const old = ctx.oldSource.get(fid);
    if (old === pred) return target;
  }
  return undefined;
}

function placeAt(ctx: PlaceCtx, plane: Plane, id: string, x: number, centreY: number, size: { width: number; height: number }): DShape {
  const s = newShape(ctx, plane, id, { x: Math.round(x), y: Math.round(centreY - size.height / 2), ...size });
  commit(ctx, plane, s);
  return s;
}

/**
 * Moves a candidate into the node's own lane when its anchor sits in another
 * lane (a candidate of a same-lane anchor may reach below the lane: it grows).
 */
function intoOwnLane(ctx: PlaceCtx, plane: Plane, probe: Probe, x: number, c: number, size: { width: number; height: number }, prefer: number[], anchor?: DShape): number {
  const lane = probe.laneId ? plane.shapes.get(probe.laneId) : undefined;
  if (!lane || (anchor && anchor.laneId === probe.laneId && c - size.height / 2 >= frameInterior(lane, 5).y)) return c;
  const inner = frameInterior(lane, 5);
  if (c - size.height / 2 >= inner.y && c + size.height / 2 <= bottom(inner)) return c;
  return rowInLane(ctx, plane, lane, x, size.width, size.height, prefer, new Set([probe.id]));
}

/**
 * How far the space tool at `line` has to push for `box` when part of the room
 * is free already (audit #77): what is in the way of the box (its obstacles
 * with their clearance, the bends of connections in its rows) and the
 * successor `S` (one gap) must end right of it. Undefined when something in
 * the way does not start beyond the line (a push cannot clear it): then the
 * caller makes a full column of room as before.
 */
function localShift(plane: Plane, box: Box, line: number, obs: { boxes: Box[]; labels: Box[] }, S: DShape | undefined, gap: number): number | undefined {
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

function placeAfter(ctx: PlaceCtx, plane: Plane, id: string, preds: DShape[], pending: ReadonlySet<string>): void {
  const sp = spacing(ctx, plane);
  const size = sizeFor(ctx, plane, id);
  const probe = probeOf(ctx, plane, id);
  const frame = frameOf(plane, probe);
  const main = preds[0]!;
  const exclude = new Set([id, ...homeGroups(plane, [main, main.hostId ? plane.shapes.get(main.hostId) : undefined])]);
  const kind = shapeKind(ctx.sem.byId.get(id)!);
  if (main.kind === 'boundary') {
    const host = main.hostId ? plane.shapes.get(main.hostId) : undefined;
    const anchor = host ?? main;
    const extent = chainExtent(ctx, plane, id, pending, sp.gap);
    const start = cy(anchor.bounds) + sp.row;
    const xs = [right(anchor.bounds) + sp.gap, Math.round(cx(main.bounds) - size.width / 2)];
    const cands = xs.flatMap((x, xi) => rowCandidates(plane, probe, frame, x, size, extent, start, sp.row, bottom(main.bounds), exclude, 40 * xi, anchor));
    placeCand(ctx, plane, id, probe, cheapest(plane, main, kind, cands), main);
    return;
  }
  const succShapes = successors(ctx.sem, main.id)
    .filter((n) => n !== id && plane.shapes.has(n))
    .map((n) => plane.shapes.get(n)!);
  const spliced = spliceTarget(ctx, id, main.id);
  const S = spliced ? plane.shapes.get(spliced) : undefined;
  const maxRight = Math.max(...preds.map((p) => right(p.bounds)));
  if (S || !succShapes.length) {
    // splice / continuation on the anchor's row
    const sameRow = S && Math.abs(cy(S.bounds) - cy(main.bounds)) <= sp.rowTol;
    const onS = !!S && (sameRow || succShapes.length > 0);
    let c = onS ? cy(S.bounds) : cy(main.bounds);
    // S's row in another lane than the node's own (a node keeping or given the anchor's lane after a branching
    // anchor): the row follows the node's lane, which never stretches over to S's row (audit #14)
    const ownRow = !!S && onS && !!probe.laneId && S.laneId !== probe.laneId;
    c = intoOwnLane(ctx, plane, probe, maxRight + sp.gap, c, size, S ? [Math.round(cy(S.bounds))] : [], ownRow ? undefined : main);
    const x = maxRight + sp.gap;
    const box = { x, y: c - size.height / 2, ...size };
    const blockers = obstacles(plane, frame, exclude);
    const succRoom = !S || Math.abs(cy(S.bounds) - c) > size.height / 2 + S.bounds.height / 2 || S.bounds.x >= right(box) + Math.min(sp.gap, 40);
    if (!isFree(box, blockers) || !succRoom) {
      const full = size.width + sp.gap;
      const delta = Math.min(full, localShift(plane, box, maxRight + 1, blockers, S, sp.gap) ?? full);
      recordSpace(ctx, makeSpace(plane, { axis: 'x', line: maxRight + 1, delta, anchors: [main.id, probe.parentId], ...spaceBand(plane, probe, main) }));
    }
    placeAt(ctx, plane, id, x, c, size);
    return;
  }
  // new branch: a free row below the anchor's existing branches (the first ones, cheapest connection)
  const x = right(main.bounds) + sp.gap;
  // the anchor's existing branches in the new node's own frame (a branch leaving into another lane does not count)
  const below = succShapes.filter((s) => cy(s.bounds) >= cy(main.bounds) - sp.rowTol && frameOf(plane, s) === frame);
  const base = Math.max(cy(main.bounds), ...below.map((s) => cy(s.bounds)));
  const floor = Math.max(bottom(main.bounds), ...below.map((s) => cy(s.bounds)));
  const cands = rowCandidates(plane, probe, frame, x, size, chainExtent(ctx, plane, id, pending, sp.gap), base + sp.row, sp.row, floor, exclude, 0, main);
  placeCand(ctx, plane, id, probe, cheapest(plane, main, kind, cands), main);
}

function placeBefore(ctx: PlaceCtx, plane: Plane, id: string, succ: DShape): void {
  const sp = spacing(ctx, plane);
  const size = sizeFor(ctx, plane, id);
  const probe = probeOf(ctx, plane, id);
  const frame = frameOf(plane, probe);
  const exclude = new Set([id, ...homeGroups(plane, [succ])]);
  const inner = frame ? frameInterior(frame, 10) : undefined;
  const x = succ.bounds.x - sp.gap - size.width;
  const obs = obstacles(plane, frame, exclude);
  if (!inner || x >= inner.x) {
    for (let k = 0; k < 3; k++) {
      const c = cy(succ.bounds) + k * sp.row;
      const box = { x, y: c - size.height / 2, ...size };
      if (isFree(box, obs)) {
        placeAt(ctx, plane, id, x, intoOwnLane(ctx, plane, probe, x, c, size, [], succ), size);
        return;
      }
    }
  }
  recordSpace(ctx, makeSpace(plane, { axis: 'x', line: succ.bounds.x - 0.5, delta: size.width + sp.gap, anchors: [succ.id, probe.parentId], ...spaceBand(plane, probe, succ) }));
  const c = intoOwnLane(ctx, plane, probe, succ.bounds.x - sp.gap - size.width, cy(succ.bounds), size, [], succ);
  placeAt(ctx, plane, id, succ.bounds.x - sp.gap - size.width, c, size);
}

/** Below the content of the node's frame, at the frame's first column. */
export function placeUnconnected(ctx: PlaceCtx, plane: Plane, id: string): DShape {
  const sp = spacing(ctx, plane);
  const size = sizeFor(ctx, plane, id);
  const probe = probeOf(ctx, plane, id);
  const frame = frameOf(plane, probe);
  const exclude = new Set([id]);
  const members = [...plane.shapes.values()].filter((s) => s.id !== id && isLeaf(s) && s.kind !== 'boundary' && s.kind !== 'annotation' && s.kind !== 'data' && within(plane, s, frame) && s !== frame);
  const inner = frame ? frameInterior(frame, frame.kind === 'subProcess' ? 20 : 15) : undefined;
  let x: number;
  let c: number;
  if (members.length) {
    x = Math.min(...members.map((s) => s.bounds.x));
    const below = contentBottom(plane, frame, exclude) ?? Math.max(...members.map((s) => bottom(s.bounds)));
    c = below + Math.max(30, sp.row - 80) + size.height / 2;
    c = freeRows(plane, frame, x, size.width, size.height, c, sp.row / 2, exclude, 1)[0]!.c;
  } else if (inner) {
    x = inner.x + (frame!.kind === 'subProcess' ? 10 : 20);
    c = frame!.kind === 'subProcess' ? inner.y + 20 + size.height / 2 : cy(inner);
  } else {
    const all = [...plane.shapes.values()].filter((s) => s.id !== id);
    const box = all.length ? all.reduce((b, s) => ({ x: Math.min(b.x, s.bounds.x), y: Math.max(b.y, bottom(s.bounds)) }), { x: Infinity, y: -Infinity }) : { x: 160, y: 40 };
    x = Number.isFinite(box.x) ? box.x : 160;
    c = (Number.isFinite(box.y) ? box.y : 40) + 60 + size.height / 2;
  }
  return placeAt(ctx, plane, id, x, c, size);
}

/**
 * Gives every flow node in `ids` a shape, in dependency order (see module
 * contract). Ids whose plane does not exist are skipped and returned.
 */
export function placeFlowNodes(ctx: PlaceCtx, ids: string[]): string[] {
  const pending = new Set(ids);
  const skipped: string[] = [];
  const shapeOn = (plane: Plane, id: string): DShape | undefined => plane.shapes.get(id);
  while (pending.size) {
    // a relocated node brings its boundary events and sub-process content back with it (commit): never place them twice
    for (const id of pending) if (ctx.planes.some((p) => p.shapes.has(id))) pending.delete(id);
    if (!pending.size) break;
    let chosen: { id: string; plane: Plane; mode: 'boundary' | 'after' | 'before' | 'free'; preds?: DShape[]; succ?: DShape } | undefined;
    for (const mode of ['boundary', 'after', 'before', 'free'] as const) {
      for (const id of pending) {
        const plane = ctx.planeFor(id);
        if (!plane) continue;
        const el = ctx.sem.byId.get(id)!;
        if (mode === 'boundary') {
          if (!is(el, 'bpmn:BoundaryEvent')) continue;
          const host = idOf(raw(el, 'attachedToRef'));
          if (host && shapeOn(plane, host)) chosen = { id, plane, mode };
        } else if (is(el, 'bpmn:BoundaryEvent') && idOf(raw(el, 'attachedToRef')) && pending.has(idOf(raw(el, 'attachedToRef'))!)) {
          continue;
        } else if (mode === 'after') {
          const preds = predecessors(ctx.sem, id).map((p) => shapeOn(plane, p)).filter((p): p is DShape => !!p);
          if (preds.length) chosen = { id, plane, mode, preds };
        } else if (mode === 'before') {
          const succ = successors(ctx.sem, id).map((p) => shapeOn(plane, p)).find((p): p is DShape => !!p);
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
      if (!placeBoundary(ctx, chosen.plane, chosen.id)) placeUnconnected(ctx, chosen.plane, chosen.id);
    } else if (chosen.mode === 'after') placeAfter(ctx, chosen.plane, chosen.id, chosen.preds!, pending);
    else if (chosen.mode === 'before') placeBefore(ctx, chosen.plane, chosen.id, chosen.succ!);
    else if (is(ctx.sem.byId.get(chosen.id)!, 'bpmn:BoundaryEvent') && placeBoundary(ctx, chosen.plane, chosen.id)) {
      /* host placed meanwhile */
    } else placeUnconnected(ctx, chosen.plane, chosen.id);
  }
  return skipped;
}

/* ------------------------------------------------------------------ */
/* artifacts                                                            */
/* ------------------------------------------------------------------ */

/** Elements an artifact is connected to (associations, data associations), in model order. */
export function artifactAnchors(ctx: PlaceCtx, id: string): string[] {
  const out: string[] = [];
  const el = ctx.sem.byId.get(id);
  if (!el) return out;
  for (const other of ctx.sem.byId.values()) {
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
export function placeArtifact(ctx: PlaceCtx, id: string): boolean {
  const plane = ctx.planeFor(id);
  if (!plane) return false;
  const el = ctx.sem.byId.get(id)!;
  const size = sizeFor(ctx, plane, id);
  const anchor = artifactAnchors(ctx, id)
    .map((a) => plane.shapes.get(a))
    .find((s): s is DShape => !!s);
  if (!anchor) {
    placeUnconnected(ctx, plane, id);
    return true;
  }
  const probe = probeOf(ctx, plane, id);
  const frame = frameOf(plane, probe);
  const obs = obstacles(plane, frame, new Set([id, ...homeGroups(plane, [anchor])]));
  const segs = edgeBoxes(plane);
  const a = unitBox(plane, anchor);
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
  const ok = (b: Box): boolean => isFree(b, obs, 15) && !segs.some((s) => overlaps(s, b, 2)) && (!inner || (b.x >= inner.x && b.y >= inner.y));
  const box = candidates.find(ok) ?? candidates.find((b) => isFree(b, obs, 10) && (!inner || (b.x >= inner.x && b.y >= inner.y))) ?? candidates[0]!;
  const s = newShape(ctx, plane, id, { ...box, x: Math.round(box.x), y: Math.round(box.y) });
  commit(ctx, plane, s);
  return true;
}
