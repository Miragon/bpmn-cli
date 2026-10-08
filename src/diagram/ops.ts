/**
 * Format operations: diagram-only edits of a kept drawing ("format without
 * XML"). An agent names elements by id and says where they go; it never
 * writes coordinates.
 *
 * CONTRACT
 *  runFormatOps(doc, entries) runs, on the DI of `doc` and in the given
 *  (batch) order, the format ops (place, align, color, label, route, space,
 *  tidy) and the diagram part of lane `order` ops. The pipeline calls it
 *  after the semantic ops and the layout ran. Each op sees the drawing as the
 *  previous op left it; everything is written back once at the end. A failing
 *  op throws a CliError carrying its batch index (`details.op`), and the
 *  pipeline then writes nothing (all or nothing with the batch).
 *   - place: the ids move as one rigid group so that the first id (the
 *     reference) lands on the row (rowOf / below / above) and / or the column
 *     (columnOf / after / before) of another element. Rows and columns are
 *     centre lines; below / above / after / before keep one row / one gap of
 *     the drawing (spacingOf) and clear the element's unit (with boundary
 *     events). Boundary events, labels and the content of an expanded
 *     sub-process follow.
 *   - align: every id moves on its own onto the centre line (row) or centre
 *     column of `to` (default: the first id, which then stays).
 *   - color: a SWATCHES colour (write.ts setSwatch) on shapes and edges;
 *     'default' removes every colour. The bioc / color namespaces are
 *     declared on the definitions when missing.
 *   - label: the external label box on one side of its element (labels.ts
 *     labelOnSide: off lines and other labels where possible; flows:
 *     edgeLabelAt), keeping the label's size.
 *   - route: one flow routed again (reroute.ts routeEdge), `exit` / `entry`
 *     forcing the side it leaves / enters by.
 *   - space: the space tool (space.ts makeSpace) at the far edge of an
 *     element: `after` moves everything starting right of it (within its
 *     pool), `below` everything starting below it; pools, lanes and the
 *     sub-processes holding the element grow where the line crosses them,
 *     any other expanded sub-process crossing it moves as a whole or stays
 *     (anchored at the element). On a pool or lane the line is just inside
 *     its far edge, so the frame itself grows. `by`: 'column' (median task width + gap, default
 *     for after), 'row' (row spacing, default for below) or pixels.
 *   - tidy: separate.ts tidy on the given shapes (default: every leaf shape
 *     of every diagram).
 *   - order (lanes): the lane bands of the owner follow the semantic lane
 *     order (ops/order.ts already reordered `laneSet.lanes`), stacked from
 *     the top of the first band, each keeping its height; nested lanes, lane
 *     members and the artifacts whose centre lies in a band move with it.
 *  place / align refuse (E_LEAVES_CONTAINER) when a moved shape would leave
 *  its innermost frame (expanded sub-process, lane, pool): its box before the
 *  frame's start, its centre in another lane or pool, or below a lane with a
 *  sibling lane underneath; past the right / bottom edge the frame grows
 *  (also for the shape's label). Then the moved shapes stay and the others
 *  give way (separate.ts), first with the references fixed, else with them
 *  movable too; moved shapes still in conflict give way along the axis the
 *  request leaves free. The request must hold afterwards (row / column /
 *  side of the reference), no sub-process may have grown over a reference,
 *  no two shapes may overlap that did not before (a reference that stayed
 *  while its neighbours made room: then the references may move too), and
 *  a reference and its frames stay where they are: it is still inside
 *  every frame that held it, and none of its frames the moved shapes are not
 *  in has moved (a pool growing towards a reference in another pool would
 *  push that pool away), else E_NO_ROOM and nothing is written.
 *  After every geometric op: connections whose ends moved by the same
 *  offset are translated, connections now broken (reroute.ts brokenEdge)
 *  are routed again, named rerouted flows get their label placed again, and
 *  a shape label a rerouted line runs over steps aside (keeping its side).
 *  Result per op: {op, index, moved (shapes whose bounds changed), rerouted
 *  (connections routed again), colored?, labels?, notes?}.
 *  Refusals: E_NO_DIAGRAM (the file has no diagram), E_NO_SHAPE (the
 *  element is not drawn), E_DIFFERENT_DIAGRAM (reference on another diagram),
 *  E_WRONG_KIND (pool / lane / boundary event where a movable shape is
 *  needed, a task for `label`, ...), E_NO_LABEL (no name to place),
 *  E_INVALID_VALUE (label side the flow has no segment for),
 *  E_LEAVES_CONTAINER, E_NO_ROOM (after making room the requested row /
 *  column no longer holds, or a sub-process would grow over the reference).
 */
import type { Doc } from '../document.js';
import { CliError, modelError, type ErrorDetails } from '../errors.js';
import { is, type El } from '../model.js';
import { laneSetOf, ordersLanes } from '../ops/order.js';
import type { AlignOp, ColorOp, FormatOp, LabelOp, OrderOp, PlaceOp, RouteOp, SpaceOp, TidyOp } from '../ops/types.js';
import { bottom, containsPoint, copyBox, copyPoints, cx, cy, inside, median, overlaps, right, sameBox, samePoints, segmentHits, type Box, type Point } from './geom.js';
import { edgeLabelAt, hasExternalLabel, labelOnSide, labelSideOf, labelSizeOf, placeEdgeLabel, placeShapeLabel } from './labels.js';
import { spacingOf } from './place.js';
import { frameInterior, frameOf, idOf, isLeaf, raw, rawList, readPlanes, semantics, type DEdge, type DShape, type Plane, type Semantics } from './plane.js';
import { brokenEdge, edgeBefore, routeEdge, routingLines, type EdgeBefore } from './reroute.js';
import type { Side } from './router.js';
import { separate, tidy } from './separate.js';
import { fitInFrame, makeSpace, shiftShape, unitBox } from './space.js';
import { setSwatch, writePlanes } from './write.js';

export interface FormatResult {
  op: FormatOp['op'] | 'order';
  /** index of the op in the batch */
  index: number;
  /** shapes whose bounds changed (moved, pushed aside, grown) */
  moved: string[];
  /** connections routed again */
  rerouted: string[];
  /** color: elements whose colour changed */
  colored?: string[];
  /** label: elements whose label was placed */
  labels?: string[];
  notes?: string[];
}

export interface FormatEntry {
  op: FormatOp | OrderOp;
  index: number;
}

interface Ctx {
  doc: Doc;
  sem: Semantics;
  planes: Plane[];
}

/** minimum clearance between a placed shape and the element it is placed below / above / after / before */
const CLEAR = 20;

/* ------------------------------------------------------------------ */
/* lookup                                                               */
/* ------------------------------------------------------------------ */

function noDiagram(): CliError {
  return modelError('E_NO_DIAGRAM', 'The file has no diagram; format operations need one', {
    hint: 'Draw it first: `bpmn layout <file>` (or run the command without --no-layout, which draws a file without diagram).',
  });
}

function noShape(ctx: Ctx, el: El, id: string, what = 'shape'): CliError {
  const details: ErrorDetails = { element: id, hint: 'It is not drawn (written with --no-layout, or outside the drawn root). Run `bpmn layout <file>` to draw it.' };
  if (is(el, 'bpmn:Process')) {
    const pool = rawList(ctx.sem.collaboration, 'participants').find((p) => raw(p, 'processRef') === el);
    if (pool) details.hint = `A process is drawn as its pool: use the participant id ${idOf(pool)}.`;
    else details.hint = 'A process without pool is the diagram itself; name the shapes inside it.';
  }
  return modelError('E_NO_SHAPE', `${id} has no ${what} in the diagram`, details);
}

function drawnShape(ctx: Ctx, id: string): { plane: Plane; shape: DShape } {
  const el = ctx.doc.require(id);
  if (!ctx.planes.length) throw noDiagram();
  for (const plane of ctx.planes) {
    const shape = plane.shapes.get(id);
    if (shape) return { plane, shape };
  }
  if (isConnectionEl(el)) throw modelError('E_WRONG_KIND', `"${id}" is a connection, expected a shape`, { element: id, hint: 'Connections follow their ends; use `bpmn route` to route one again.' });
  throw noShape(ctx, el, id);
}

function drawnEdge(ctx: Ctx, id: string): { plane: Plane; edge: DEdge } {
  const el = ctx.doc.require(id, ['bpmn:SequenceFlow', 'bpmn:MessageFlow'], 'sequence or message flow');
  if (!ctx.planes.length) throw noDiagram();
  for (const plane of ctx.planes) {
    const edge = plane.edges.get(id);
    if (edge) return { plane, edge };
  }
  throw noShape(ctx, el, id, 'connection');
}

const isConnectionEl = (el: El): boolean => is(el, 'bpmn:SequenceFlow') || is(el, 'bpmn:MessageFlow') || is(el, 'bpmn:Association') || is(el, 'bpmn:DataAssociation');

/** A shape place / align may move: a flow node (not a boundary event), data element or annotation. */
function movableShape(ctx: Ctx, id: string): { plane: Plane; shape: DShape } {
  const found = drawnShape(ctx, id);
  const s = found.shape;
  if (s.kind === 'boundary') {
    throw modelError('E_WRONG_KIND', `"${id}" is a boundary event; it follows its host ${s.hostId ?? ''}`.trim(), { element: id, ...(s.hostId ? { related: [s.hostId] } : {}), hint: `Place the host instead${s.hostId ? ` (${s.hostId})` : ''}; \`bpmn move ${id} --on <activityId>\` attaches it elsewhere.` });
  }
  if (s.kind === 'participant' || s.kind === 'lane' || s.kind === 'group' || s.kind === 'other') {
    throw modelError('E_WRONG_KIND', `"${id}" is a ${s.kind === 'participant' ? 'pool' : s.kind}, expected a node, data element or annotation`, {
      element: id,
      hint: 'Pools and lanes are bands: `bpmn order <file> <poolId> <laneIds...>` reorders lanes, `bpmn space <file> --below <laneId>` makes one taller.',
    });
  }
  return found;
}

function samePlane(plane: Plane, other: Plane, id: string, refId: string): void {
  if (plane === other) return;
  throw modelError('E_DIFFERENT_DIAGRAM', `${id} and ${refId} are drawn on different diagrams`, {
    element: id,
    related: [refId],
    hint: 'Shapes inside a collapsed sub-process live on their own diagram; refer to elements of the same one (or expand the sub-process: `bpmn set <file> <subProcessId> expanded=true`).',
  });
}

function unique(ids: readonly string[]): string[] {
  return ids.filter((id, i) => ids.indexOf(id) === i);
}

/** Drops shapes that move with another listed shape (content of a listed expanded sub-process). */
function outermost(plane: Plane, shapes: DShape[]): DShape[] {
  const ids = new Set(shapes.map((s) => s.id));
  return shapes.filter((s) => {
    let p = s.parentId;
    for (let i = 0; p && i < 20; i++) {
      if (ids.has(p)) return false;
      p = plane.shapes.get(p)?.parentId;
    }
    return true;
  });
}

/* ------------------------------------------------------------------ */
/* snapshot and settling                                                */
/* ------------------------------------------------------------------ */

interface Snap {
  bounds: Map<string, Box>;
  points: Map<string, Point[]>;
  edges: Map<DEdge, EdgeBefore>;
}

function snapshot(planes: readonly Plane[]): Snap {
  const out: Snap = { bounds: new Map(), points: new Map(), edges: new Map() };
  for (const plane of planes) {
    for (const s of plane.shapes.values()) out.bounds.set(s.id, copyBox(s.bounds));
    for (const e of plane.edges.values()) {
      out.points.set(e.id, copyPoints(e.points));
      out.edges.set(e, edgeBefore(plane, e));
    }
  }
  return out;
}

function changedShapes(planes: readonly Plane[], snap: Snap): string[] {
  const out: string[] = [];
  for (const plane of planes) {
    for (const s of plane.shapes.values()) {
      const b = snap.bounds.get(s.id);
      if (b && !sameBox(b, s.bounds)) out.push(s.id);
    }
  }
  return out;
}

/** Shape labels a fresh line runs over step aside, keeping their side. */
function clearLabels(plane: Plane, fresh: readonly DEdge[]): void {
  const segs = fresh.flatMap((e) => e.points.slice(1).map((q, i) => [e.points[i]!, q] as const));
  if (!segs.length) return;
  for (const s of plane.shapes.values()) {
    if (!s.label || !hasExternalLabel(s) || !segs.some(([p, q]) => segmentHits(p, q, s.label!, 1))) continue;
    const host = s.hostId ? plane.shapes.get(s.hostId)?.bounds : undefined;
    const side = labelSideOf(s, host);
    placeShapeLabel(plane, s, side === 'inside' ? undefined : side);
  }
}

/** Routes one connection again (with its label); false when an end has no shape. */
function reroute(plane: Plane, e: DEdge, sides: { sourceSides?: Side[]; targetSides?: Side[] } = {}): boolean {
  const pts = routeEdge(plane, e, { lines: routingLines(plane, e.id), ...sides });
  if (!pts || pts.length < 2) return false;
  e.points = pts;
  if (e.label || raw<string>(e.el, 'name')) placeEdgeLabel(plane, e);
  return true;
}

/**
 * After shapes moved on `plane`: connections whose ends moved by the same
 * offset are translated, broken ones routed again, labels cleared (see
 * module contract). Returns the rerouted connection ids.
 */
function settle(plane: Plane, snap: Snap): string[] {
  const delta = new Map<string, { dx: number; dy: number }>();
  for (const s of plane.shapes.values()) {
    const b = snap.bounds.get(s.id);
    if (!b || Math.abs(b.width - s.bounds.width) > 0.5 || Math.abs(b.height - s.bounds.height) > 0.5) continue;
    const dx = s.bounds.x - b.x;
    const dy = s.bounds.y - b.y;
    if (dx || dy) delta.set(s.id, { dx, dy });
  }
  for (const e of plane.edges.values()) {
    const old = snap.points.get(e.id);
    if (!old || !samePoints(old, e.points)) continue;
    const a = e.sourceId ? delta.get(e.sourceId) : undefined;
    const b = e.targetId ? delta.get(e.targetId) : undefined;
    if (!a || !b || a.dx !== b.dx || a.dy !== b.dy) continue;
    for (const p of e.points) {
      p.x += a.dx;
      p.y += a.dy;
    }
    if (e.label) {
      e.label.x += a.dx;
      e.label.y += a.dy;
    }
  }
  const rerouted: DEdge[] = [];
  // sequence flows first, message flows last (they cross the pools and should see the final flows)
  const edges = [...plane.edges.values()].sort((p, q) => Number(p.kind === 'messageFlow') - Number(q.kind === 'messageFlow'));
  for (const e of edges) {
    if (!brokenEdge(plane, e, snap.edges.get(e))) continue;
    if (reroute(plane, e)) rerouted.push(e);
  }
  clearLabels(plane, rerouted);
  return rerouted.map((e) => e.id);
}

/* ------------------------------------------------------------------ */
/* frames                                                               */
/* ------------------------------------------------------------------ */

function frameWord(f: DShape): string {
  return f.kind === 'participant' ? 'pool' : f.kind === 'lane' ? 'lane' : 'sub-process';
}

/** The innermost lane of a pool whose band contains `p`. */
function laneAt(plane: Plane, poolId: string | undefined, p: Point): DShape | undefined {
  let best: DShape | undefined;
  for (const s of plane.shapes.values()) {
    if (s.kind !== 'lane' || s.poolId !== poolId || !containsPoint(s.bounds, p)) continue;
    if (!best || s.bounds.width * s.bounds.height < best.bounds.width * best.bounds.height) best = s;
  }
  return best;
}

/**
 * Where a moved shape would leave its innermost frame: its box before the
 * frame's start (left of its interior, above its top), its centre in another
 * lane or pool, or below a lane that has a sibling lane underneath. Past the
 * right edge (and the bottom of the last lane / a pool / a sub-process) is
 * fine: the frame grows. Returns the lane / pool the centre would land in,
 * the frame itself when the shape would just leave it, or undefined when it
 * stays.
 */
function escape(plane: Plane, s: DShape, frame: DShape, box: Box): DShape | undefined {
  const inner = frameInterior(frame, 0);
  const c = { x: cx(box), y: cy(box) };
  if (box.x < inner.x - 0.5 || box.y < frame.bounds.y - 0.5) return frame;
  const otherPool = [...plane.shapes.values()].find((p) => p.kind === 'participant' && p.id !== s.poolId && containsPoint(p.bounds, c));
  if (otherPool) return otherPool;
  if (frame.kind !== 'lane') return undefined;
  const there = laneAt(plane, s.poolId, c);
  if (there) return there.id === frame.id ? undefined : there;
  // below the lane (and right of the pool): only the last lane of the pool may grow downwards
  const below = c.y >= bottom(frame.bounds) && [...plane.shapes.values()].some((l) => l.kind === 'lane' && l.poolId === s.poolId && l.bounds.y >= bottom(frame.bounds) - 1);
  return below ? frame : undefined;
}

/** Refuses a move that takes a shape out of its innermost frame (E_LEAVES_CONTAINER, see escape). */
function checkFrames(plane: Plane, shapes: readonly DShape[], dx: number, dy: number, target: string): void {
  for (const s of shapes) {
    const frame = frameOf(plane, s);
    if (!frame) continue;
    const unit = unitBox(plane, s);
    const there = escape(plane, s, frame, { ...unit, x: unit.x + dx, y: unit.y + dy });
    if (!there) continue;
    let hint: string;
    if (frame.kind === 'lane') {
      hint = there.kind === 'lane'
        ? `That position is in lane ${there.id}. Assign the lane first (\`bpmn move <file> ${s.id} --lane ${there.id}\`, in a batch a move op with "lane" before this op), or make room in ${frame.id} first (\`bpmn space <file> --below ${frame.id}\`).`
        : `Pick a reference inside lane ${frame.id}, or assign another lane first (\`bpmn move <file> ${s.id} --lane <laneId>\`).`;
    } else if (frame.kind === 'subProcess') {
      hint = `Pick a reference inside ${frame.id}, or move the node out of the sub-process first (\`bpmn move <file> ${s.id} --in <scopeId>\`).`;
    } else {
      hint = `Nodes cannot leave their pool; pick a reference inside ${frame.id}.`;
    }
    throw modelError('E_LEAVES_CONTAINER', `Placing ${s.id} ${target} would move it out of its ${frameWord(frame)} ${frame.id}${there !== frame ? ` (into ${there.kind === 'participant' ? 'pool' : 'lane'} ${there.id})` : ''}`, { element: s.id, related: [frame.id, ...(there !== frame ? [there.id] : [])], hint });
  }
}

/** The frame chain of a shape, innermost first (expanded sub-processes, lanes, pool). */
function framesOf(plane: Plane, s: DShape): DShape[] {
  const out: DShape[] = [];
  let f = frameOf(plane, s);
  for (let i = 0; f && i < 16 && !out.includes(f); i++) {
    out.push(f);
    f = frameOf(plane, f);
  }
  return out;
}

/**
 * The frame a reference lost: one that held it before the op and no longer
 * does, or one holding none of the moved shapes that moved (pushed away by
 * a frame that grew). Undefined when its frames are intact.
 */
function frameLeft(plane: Plane, ref: DShape, snap: Snap, movedFrames: ReadonlySet<string>): DShape | undefined {
  const was = snap.bounds.get(ref.id);
  let lost: DShape | undefined;
  for (const f of framesOf(plane, ref)) {
    const fb = snap.bounds.get(f.id);
    if (!fb || !was) continue;
    const left = inside(was, fb) && !inside(ref.bounds, f.bounds);
    const pushed = !movedFrames.has(f.id) && (Math.abs(f.bounds.x - fb.x) > 0.5 || Math.abs(f.bounds.y - fb.y) > 0.5);
    if (left || pushed) lost = f; // the outermost one: a pool pushed away takes its lanes along
  }
  return lost;
}

/**
 * Pairs of leaf shapes that overlap now but did not before the op (a
 * boundary event on its own host does not count): making room must never
 * push one shape onto another, e.g. onto a reference that stayed while the
 * shapes around it made room.
 */
function newOverlaps(plane: Plane, snap: Snap): Array<[string, string]> {
  const leaves = [...plane.shapes.values()].filter(isLeaf);
  const out: Array<[string, string]> = [];
  for (let i = 0; i < leaves.length; i++) {
    for (let j = i + 1; j < leaves.length; j++) {
      const a = leaves[i]!;
      const b = leaves[j]!;
      if (a.hostId === b.id || b.hostId === a.id || !overlaps(a.bounds, b.bounds)) continue;
      const was = [snap.bounds.get(a.id), snap.bounds.get(b.id)];
      if (was[0] && was[1] && overlaps(was[0], was[1])) continue;
      out.push([a.id, b.id]);
    }
  }
  return out;
}

/** Every leaf shape of a plane (the units separate may push aside). */
function leafIds(plane: Plane): string[] {
  return [...plane.shapes.values()].filter((s) => isLeaf(s) || (s.kind === 'subProcess' && s.container)).map((s) => s.id);
}

/** Grows the frame of a moved shape when its external label hangs out at the bottom (lanes below, pools below make room). */
function fitLabel(plane: Plane, s: DShape, keep: string[]): void {
  const frame = frameOf(plane, s);
  if (!frame || !s.label) return;
  const over = bottom(s.label) + 5 - bottom(frame.bounds);
  if (over <= 0.5) return;
  makeSpace(plane, { axis: 'y', line: bottom(frame.bounds) - 1, delta: Math.ceil(over), keep: new Set(keep), ...(frame.kind === 'subProcess' ? { within: copyBox(frame.bounds), frame: frame.id } : {}) });
}

/** Everything a plane draws (bounds, labels, waypoints), to try something and undo it. */
interface PlaneState {
  shapes: Map<DShape, { bounds: Box; label?: Box }>;
  edges: Map<DEdge, { points: Point[]; label?: Box }>;
}

function saveState(plane: Plane): PlaneState {
  const st: PlaneState = { shapes: new Map(), edges: new Map() };
  for (const s of plane.shapes.values()) st.shapes.set(s, { bounds: copyBox(s.bounds), ...(s.label ? { label: copyBox(s.label) } : {}) });
  for (const e of plane.edges.values()) st.edges.set(e, { points: copyPoints(e.points), ...(e.label ? { label: copyBox(e.label) } : {}) });
  return st;
}

function restoreState(st: PlaneState): void {
  for (const [s, v] of st.shapes) {
    s.bounds = copyBox(v.bounds);
    if (v.label) s.label = copyBox(v.label);
    else delete s.label;
  }
  for (const [e, v] of st.edges) {
    e.points = copyPoints(v.points);
    if (v.label) e.label = copyBox(v.label);
    else delete e.label;
  }
}

/**
 * Shapes moved on request stay; the others give way (separate.ts). First the
 * references stay too; when the request then does not hold (`holds`, e.g.
 * "same row as R"), or two shapes ended up on each other, the references may
 * give way as well (a row reference sliding right keeps its row). When a
 * conflict with a moved shape is left, the moved shapes may give way a
 * little (noted). Refused (E_NO_ROOM, the batch fails) when the request holds
 * in neither way, a new overlap is left, or a sub-process grew over a
 * reference.
 */
function makeRoom(plane: Plane, moved: readonly DShape[], refs: readonly DShape[], snap: Snap, notes: string[], target: string, holds: () => boolean, lock: ReadonlyArray<'x' | 'y'>): void {
  const ids = moved.flatMap((s) => [s.id, ...[...plane.shapes.values()].filter((b) => b.hostId === s.id).map((b) => b.id)]);
  const refIds = refs.map((f) => f.id).filter((id) => !ids.includes(id));
  const all = leafIds(plane);
  const within = (f: DShape, subId: string): boolean => {
    let p = f.parentId ?? (f.hostId ? plane.shapes.get(f.hostId)?.parentId : undefined);
    for (let i = 0; p && i < 20; i++) {
      if (p === subId) return true;
      p = plane.shapes.get(p)?.parentId;
    }
    return f.hostId === subId;
  };
  // a reference pushed out of a frame that held it, or whose own frame (one the moved shapes are not in) was pushed away
  const movedFrames = new Set(moved.flatMap((s) => framesOf(plane, s).map((f) => f.id)));
  const displaced = (): Array<{ ref: DShape; frame: DShape }> =>
    refs.flatMap((f) => {
      const frame = ids.includes(f.id) ? undefined : frameLeft(plane, f, snap, movedFrames);
      return frame ? [{ ref: f, frame }] : [];
    });
  // a reference drawn over by a sub-process that grew
  const swallowed = (): DShape[] =>
    refs.filter(
      (f) =>
        !ids.includes(f.id) &&
        [...plane.shapes.values()].some((c) => c.kind === 'subProcess' && c.container && c.id !== f.id && !within(f, c.id) && overlaps(c.bounds, f.bounds) && !overlaps(snap.bounds.get(c.id) ?? c.bounds, snap.bounds.get(f.id) ?? f.bounds)),
    );
  const attempt = (fixed: string[]): { ok: boolean; notes: string[]; swallowed: DShape[]; displaced: Array<{ ref: DShape; frame: DShape }>; collided: Array<[string, string]> } => {
    const out: string[] = [];
    for (const s of moved) {
      fitInFrame(plane, s.id, 15, undefined, [...ids, ...fixed]);
      fitLabel(plane, s, [...ids, ...fixed]);
    }
    const first = separate(plane, { active: ids, movable: all, pinned: [...ids, ...fixed], baseline: snap.bounds });
    const stuck = first.unresolved.filter(([a, b]) => ids.includes(a) || ids.includes(b));
    let left = false;
    if (stuck.length) {
      // the moved shapes give way along the axis the request leaves free
      const second = separate(plane, { active: ids, movable: all, pinned: fixed, locked: { ids, axes: lock }, baseline: snap.bounds });
      left = second.unresolved.some(([a, b]) => ids.includes(a) || ids.includes(b));
      if (!left) out.push(`moved ${moved.map((s) => s.id).join(', ')} ${lock.includes('x') ? 'down' : 'right'} a little to clear ${stuck.map(([a, b]) => (ids.includes(a) ? b : a)).join(', ')}`);
    }
    const sw = swallowed();
    const gone = displaced();
    const collided = newOverlaps(plane, snap);
    return { ok: !sw.length && !gone.length && !collided.length && !left && holds(), notes: out, swallowed: sw, displaced: gone, collided };
  };
  const start = saveState(plane);
  let r = attempt(refIds);
  if (!r.ok && refIds.length) {
    restoreState(start);
    r = attempt([]);
  }
  if (!r.ok) {
    const names = moved.map((s) => s.id).join(', ');
    const why = r.swallowed.length
      ? `its frame would have to grow over ${r.swallowed.map((f) => f.id).join(', ')}`
      : r.displaced.length
        ? `its frame would have to push away ${r.displaced.map((d) => `${frameWord(d.frame)} ${d.frame.id} of ${d.ref.id}`).join(', ')}`
        : r.collided.length
          ? `making room would put ${r.collided.map(([a, b]) => `${a} onto ${b}`).join(', ')}`
          : 'what is in the way cannot give way without moving the reference or the shapes off it';
    throw modelError('E_NO_ROOM', `There is no room to put ${names} ${target}: ${why}`, {
      element: moved[0]!.id,
      related: r.swallowed.length ? r.swallowed.map((f) => f.id) : r.displaced.length ? r.displaced.flatMap((d) => [d.ref.id, d.frame.id]) : r.collided.length ? [...new Set(r.collided.flat())] : refs.map((f) => f.id),
      hint: 'Use a reference inside the same lane / sub-process, or make room first (`bpmn space <file> --after <id>` / `--below <id>`) and place it again.',
    });
  }
  notes.push(...r.notes);
}

/* ------------------------------------------------------------------ */
/* place / align                                                        */
/* ------------------------------------------------------------------ */

function placeOp(ctx: Ctx, op: PlaceOp, snap: Snap, notes: string[]): string[] {
  const items = unique(op.ids).map((id) => movableShape(ctx, id));
  const { plane, shape: ref } = items[0]!;
  for (const it of items) samePlane(plane, it.plane, it.shape.id, ref.id);
  const group = outermost(plane, items.map((i) => i.shape));
  const sp = spacingOf(plane);
  const refUnit = unitBox(plane, ref);
  const fixed: DShape[] = [];
  const target = (id: string): { shape: DShape; unit: Box } => {
    const t = drawnShape(ctx, id);
    samePlane(plane, t.plane, ref.id, id);
    fixed.push(t.shape);
    return { shape: t.shape, unit: t.shape.container ? t.shape.bounds : unitBox(plane, t.shape) };
  };
  let dx = 0;
  let dy = 0;
  const parts: string[] = [];
  if (op.rowOf) {
    dy = cy(target(op.rowOf).shape.bounds) - cy(ref.bounds);
    parts.push(`in the row of ${op.rowOf}`);
  } else if (op.below) {
    const t = target(op.below);
    const top = refUnit.y - ref.bounds.y;
    const want = Math.max(cy(t.shape.bounds) + sp.row, bottom(t.unit) + CLEAR - top + ref.bounds.height / 2);
    dy = want - cy(ref.bounds);
    parts.push(`below ${op.below}`);
  } else if (op.above) {
    const t = target(op.above);
    const below = bottom(refUnit) - bottom(ref.bounds);
    const want = Math.min(cy(t.shape.bounds) - sp.row, t.unit.y - CLEAR - below - ref.bounds.height / 2);
    dy = want - cy(ref.bounds);
    parts.push(`above ${op.above}`);
  }
  if (op.columnOf) {
    dx = cx(target(op.columnOf).shape.bounds) - cx(ref.bounds);
    parts.push(`in the column of ${op.columnOf}`);
  } else if (op.after) {
    dx = right(target(op.after).unit) + sp.gap - refUnit.x;
    parts.push(`after ${op.after}`);
  } else if (op.before) {
    dx = target(op.before).unit.x - sp.gap - right(refUnit);
    parts.push(`before ${op.before}`);
  }
  dx = Math.round(dx);
  dy = Math.round(dy);
  checkFrames(plane, group, dx, dy, parts.join(' and '));
  if (!dx && !dy) {
    notes.push(`${ref.id} is already there`);
    return [];
  }
  for (const s of group) shiftShape(plane, s.id, dx, dy);
  const unit = (s: DShape): Box => (s.container ? s.bounds : unitBox(plane, s));
  const shape = (id: string): DShape => plane.shapes.get(id)!;
  const holds = (): boolean => {
    const r = unitBox(plane, ref);
    const rowOk = op.rowOf ? Math.abs(cy(ref.bounds) - cy(shape(op.rowOf).bounds)) <= 1 : op.below ? r.y >= bottom(unit(shape(op.below))) - 1 : op.above ? bottom(r) <= unit(shape(op.above)).y + 1 : true;
    const colOk = op.columnOf ? Math.abs(cx(ref.bounds) - cx(shape(op.columnOf).bounds)) <= 1 : op.after ? r.x >= right(unit(shape(op.after))) - 1 : op.before ? right(r) <= unit(shape(op.before)).x + 1 : true;
    return rowOk && colOk;
  };
  const lock: Array<'x' | 'y'> = [...(op.columnOf || op.after || op.before ? ['x' as const] : []), ...(op.rowOf || op.below || op.above ? ['y' as const] : [])];
  makeRoom(plane, group, fixed, snap, notes, parts.join(' and '), holds, lock);
  return settle(plane, snap);
}

function alignOp(ctx: Ctx, op: AlignOp, snap: Snap, notes: string[]): string[] {
  const refId = op.to ?? op.ids[0]!;
  const { plane, shape: ref } = drawnShape(ctx, refId);
  const items = unique(op.ids)
    .filter((id) => id !== refId)
    .map((id) => movableShape(ctx, id));
  for (const it of items) samePlane(plane, it.plane, it.shape.id, refId);
  const shapes = outermost(plane, items.map((i) => i.shape));
  const moves = shapes.map((s) => ({ s, dx: op.axis === 'column' ? Math.round(cx(ref.bounds) - cx(s.bounds)) : 0, dy: op.axis === 'row' ? Math.round(cy(ref.bounds) - cy(s.bounds)) : 0 }));
  for (const m of moves) checkFrames(plane, [m.s], m.dx, m.dy, `in the ${op.axis} of ${refId}`);
  const moved = moves.filter((m) => m.dx || m.dy);
  if (!moved.length) {
    notes.push(`already aligned on the ${op.axis} of ${refId}`);
    return [];
  }
  for (const m of moved) shiftShape(plane, m.s.id, m.dx, m.dy);
  const line = (b: Box): number => (op.axis === 'column' ? cx(b) : cy(b));
  const holds = (): boolean => moved.every((m) => Math.abs(line(m.s.bounds) - line(ref.bounds)) <= 1);
  makeRoom(plane, moved.map((m) => m.s), [ref], snap, notes, `on the ${op.axis} of ${refId}`, holds, [op.axis === 'column' ? 'x' : 'y']);
  return settle(plane, snap);
}

/* ------------------------------------------------------------------ */
/* color / label / route                                                */
/* ------------------------------------------------------------------ */

function colorOp(ctx: Ctx, op: ColorOp): string[] {
  const colored: string[] = [];
  const swatch = op.color === 'default' ? undefined : op.color;
  for (const id of unique(op.ids)) {
    const el = ctx.doc.require(id);
    if (!ctx.planes.length) throw noDiagram();
    const shape = ctx.planes.map((p) => p.shapes.get(id)).find((s) => !!s);
    const edge = shape ? undefined : ctx.planes.map((p) => p.edges.get(id)).find((e) => !!e);
    const di = shape?.di ?? edge?.di;
    if (!di) throw noShape(ctx, el, id, 'shape or connection');
    if (setSwatch(di, swatch)) colored.push(id);
  }
  if (swatch && colored.length) {
    ctx.doc.declareNamespace('bioc');
    ctx.doc.declareNamespace('color');
  }
  return colored;
}

function labelOp(ctx: Ctx, op: LabelOp): string[] {
  const el = ctx.doc.require(op.id);
  const name = raw<string>(el, 'name')?.trim();
  if (is(el, 'bpmn:SequenceFlow') || is(el, 'bpmn:MessageFlow')) {
    const { edge } = drawnEdge(ctx, op.id);
    if (!name) throw modelError('E_NO_LABEL', `${op.id} has no name, so it has no label`, { element: op.id, hint: `Name it first: \`bpmn set <file> ${op.id} name=...\`.` });
    const size = edge.label ? { width: edge.label.width, height: edge.label.height } : labelSizeOf(name);
    const box = edgeLabelAt(edge, size, op.side);
    if (!box) {
      const want = op.side === 'left' || op.side === 'right' ? 'vertical' : 'horizontal';
      throw modelError('E_INVALID_VALUE', `${op.id} has no ${want} segment to put its label ${op.side === 'left' || op.side === 'right' ? 'beside' : op.side}`, {
        element: op.id,
        hint: want === 'vertical' ? 'Use side above or below.' : 'Use side left or right.',
      });
    }
    const changed = !sameBox(edge.label, box);
    edge.label = box;
    return changed ? [op.id] : [];
  }
  const { plane, shape } = drawnShape(ctx, op.id);
  if (!hasExternalLabel(shape)) {
    throw modelError('E_WRONG_KIND', `"${op.id}" has no external label (tasks, sub-processes, pools and lanes carry their name inside the shape)`, {
      element: op.id,
      hint: 'Labels can be placed for events, gateways, data objects / stores and flows.',
    });
  }
  if (!name) throw modelError('E_NO_LABEL', `${op.id} has no name, so it has no label`, { element: op.id, hint: `Name it first: \`bpmn set <file> ${op.id} name=...\`.` });
  const size = shape.label ? { width: shape.label.width, height: shape.label.height } : labelSizeOf(name);
  const box = labelOnSide(plane, shape, op.side, size);
  const changed = !sameBox(shape.label, box);
  shape.label = box;
  return changed ? [op.id] : [];
}

function routeOp(ctx: Ctx, op: RouteOp): string[] {
  const { plane, edge } = drawnEdge(ctx, op.id);
  const before = copyPoints(edge.points);
  const ok = reroute(plane, edge, { ...(op.exit ? { sourceSides: [op.exit] } : {}), ...(op.entry ? { targetSides: [op.entry] } : {}) });
  if (!ok) throw modelError('E_NO_SHAPE', `${op.id} cannot be routed: an end has no shape in its diagram`, { element: op.id, hint: 'Run `bpmn layout <file>` to draw the missing shapes.' });
  clearLabels(plane, [edge]);
  return samePoints(before, edge.points) ? [] : [op.id];
}

/* ------------------------------------------------------------------ */
/* space / tidy                                                         */
/* ------------------------------------------------------------------ */

/** One column of the drawing: the median task width plus the gap. */
function columnWidth(plane: Plane): number {
  const widths = [...plane.shapes.values()].filter((s) => s.kind === 'task').map((s) => s.bounds.width);
  return Math.round((median(widths) ?? 100) + spacingOf(plane).gap);
}

function spaceOp(ctx: Ctx, op: SpaceOp, snap: Snap): string[] {
  const refId = (op.after ?? op.below)!;
  const { plane, shape } = drawnShape(ctx, refId);
  const axis = op.after ? 'x' : 'y';
  const by = op.by ?? (axis === 'x' ? 'column' : 'row');
  const delta = by === 'column' ? columnWidth(plane) : by === 'row' ? spacingOf(plane).row : by;
  // a frame grows itself: the line runs just inside its far edge
  const box = shape.container ? shape.bounds : unitBox(plane, shape);
  const line = shape.container ? (axis === 'x' ? right(box) - 1 : bottom(box) - 1) : axis === 'x' ? right(box) + 1 : bottom(box) + 1;
  const pool = shape.kind === 'participant' ? shape : shape.poolId ? plane.shapes.get(shape.poolId) : undefined;
  makeSpace(plane, { axis, line, delta, anchors: [shape.id], ...(axis === 'x' && pool ? { within: copyBox(pool.bounds) } : {}) });
  return settle(plane, snap);
}

function tidyOp(ctx: Ctx, op: TidyOp, snap: Snap, notes: string[]): string[] {
  if (!ctx.planes.length) throw noDiagram();
  const byPlane = new Map<Plane, string[]>();
  if (op.ids) {
    for (const id of unique(op.ids)) {
      const { plane } = drawnShape(ctx, id);
      byPlane.set(plane, [...(byPlane.get(plane) ?? []), id]);
    }
  } else for (const plane of ctx.planes) byPlane.set(plane, []);
  const rerouted: string[] = [];
  for (const [plane, ids] of byPlane) {
    const r = tidy(plane, ids.length ? { ids } : {});
    if (r.unresolved.length) notes.push(`overlap left: ${r.unresolved.map(([a, b]) => `${a}~${b}`).join(', ')}`);
    rerouted.push(...settle(plane, snap));
  }
  return rerouted;
}

/* ------------------------------------------------------------------ */
/* lane order                                                           */
/* ------------------------------------------------------------------ */

/** Lane ids of a lane's subtree (the lane included). */
function laneSubtree(sem: Semantics, laneId: string): Set<string> {
  const out = new Set([laneId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const [child, parent] of sem.laneParent) {
      if (out.has(parent) && !out.has(child)) {
        out.add(child);
        grew = true;
      }
    }
  }
  return out;
}

function orderBands(ctx: Ctx, op: OrderOp, snap: Snap, notes: string[]): string[] {
  const owner = ctx.doc.get(op.id);
  const set = owner ? laneSetOf(owner) : undefined;
  const lanes = rawList(set, 'lanes').map((l) => idOf(l)!).filter(Boolean);
  const plane = ctx.planes.find((p) => lanes.length > 0 && lanes.every((id) => p.shapes.has(id)));
  if (!plane) {
    if (ctx.planes.length) notes.push('the lanes are not drawn: nothing to reorder in the diagram');
    return [];
  }
  const bands = lanes.map((id) => plane.shapes.get(id)!);
  const byY = [...bands].sort((a, b) => a.bounds.y - b.bounds.y);
  if (bands.every((b, i) => b === byY[i])) return [];
  // who moves with which band (decided before anything moves)
  const subtrees = new Map(bands.map((b) => [b.id, laneSubtree(ctx.sem, b.id)]));
  const poolId = bands[0]!.poolId;
  const members = new Map<string, string[]>(bands.map((b) => [b.id, []]));
  for (const s of plane.shapes.values()) {
    if (s.kind === 'participant' || s.hostId || s.parentId) continue;
    let band: string | undefined;
    if (s.kind === 'lane') band = bands.find((b) => b.id !== s.id && subtrees.get(b.id)!.has(s.id))?.id;
    else if (s.laneId) band = bands.find((b) => subtrees.get(b.id)!.has(s.laneId!))?.id;
    else if (s.poolId === poolId && !s.container) band = bands.find((b) => cy(s.bounds) >= b.bounds.y && cy(s.bounds) < bottom(b.bounds))?.id;
    if (band) members.get(band)!.push(s.id);
  }
  let cursor = byY[0]!.bounds.y;
  const moves: Array<{ band: DShape; dy: number }> = [];
  for (const b of bands) {
    moves.push({ band: b, dy: cursor - b.bounds.y });
    cursor += b.bounds.height;
  }
  for (const { band, dy } of moves) {
    if (!dy) continue;
    band.bounds.y += dy;
    for (const id of members.get(band.id)!) {
      const s = plane.shapes.get(id)!;
      if (s.kind === 'lane') s.bounds.y += dy;
      else shiftShape(plane, id, 0, dy);
    }
  }
  return settle(plane, snap);
}

/* ------------------------------------------------------------------ */
/* entry point                                                          */
/* ------------------------------------------------------------------ */

function runOne(ctx: Ctx, entry: FormatEntry): FormatResult | undefined {
  const { op, index } = entry;
  if (op.op === 'order' && !ordersLanes(ctx.doc, op)) return undefined;
  const snap = snapshot(ctx.planes);
  const notes: string[] = [];
  let rerouted: string[] = [];
  const extra: Partial<FormatResult> = {};
  switch (op.op) {
    case 'place':
      rerouted = placeOp(ctx, op, snap, notes);
      break;
    case 'align':
      rerouted = alignOp(ctx, op, snap, notes);
      break;
    case 'color':
      extra.colored = colorOp(ctx, op);
      break;
    case 'label':
      extra.labels = labelOp(ctx, op);
      break;
    case 'route':
      rerouted = routeOp(ctx, op);
      break;
    case 'space':
      rerouted = spaceOp(ctx, op, snap);
      break;
    case 'tidy':
      rerouted = tidyOp(ctx, op, snap, notes);
      break;
    case 'order':
      rerouted = orderBands(ctx, op, snap, notes);
      break;
  }
  return { op: op.op, index, moved: changedShapes(ctx.planes, snap), rerouted: unique(rerouted), ...extra, ...(notes.length ? { notes } : {}) };
}

/** Runs the format ops of a batch on the drawing of `doc` (see module contract). */
export function runFormatOps(doc: Doc, entries: readonly FormatEntry[]): FormatResult[] {
  const sem = semantics(doc.definitions);
  const ctx: Ctx = { doc, sem, planes: readPlanes(doc.definitions, sem) };
  const results: FormatResult[] = [];
  for (const entry of entries) {
    try {
      const r = runOne(ctx, entry);
      if (r) results.push(r);
    } catch (err) {
      if (err instanceof CliError) err.details['op'] = entry.index;
      throw err;
    }
  }
  writePlanes(doc.moddle, doc.definitions, ctx.planes);
  doc.invalidate();
  return results;
}
