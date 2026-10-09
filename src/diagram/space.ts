/**
 * The space tool of the modeler, on a plane (src/diagram/plane.ts).
 *
 * CONTRACT
 *  makeSpace(plane, {axis, line, delta, within?, frame?, keep?, anchors?})
 *   - every non-container shape whose near edge (x for axis 'x', y for 'y')
 *     is at or beyond `line` moves by `delta` along the axis, with its label;
 *     boundary events follow their host (never their own position); on a
 *     container host that is resized they stay on its border: the ones whose
 *     centre is beyond the line move with the part of the border that moves
 *   - collaboration-level artifacts (no semantic pool) go with the pool they
 *     are drawn in
 *   - containers (pool, lane, expanded sub-process) entirely beyond the line
 *     move; containers crossing the line grow by `delta` (shrink for a
 *     negative delta); lanes of a pool that grows on x grow with it, and pools
 *     whose right edge was aligned with it stay aligned
 *   - a negative delta shrinks only the containers inside the `within` band
 *     (closing a strip in a sub-process leaves the lane and pool around it
 *     alone), and never past a container's own members (+10 px)
 *   - `anchors` (the elements the room is made for; growing only): an
 *     expanded sub-process the line crosses grows only when it holds an
 *     anchor (is one, or one of its ancestors). Any other crossed expanded
 *     sub-process is never stretched: it moves as a whole (boundary events,
 *     content, inner connections and their labels) when its centre lies
 *     beyond the line, else it stays exactly as it is. Without `anchors`
 *     every crossed container grows (the modeler's space tool)
 *   - edge end points follow the shape they dock on (moved shape: shifted;
 *     crossed container: the line rule; untouched shape: kept); interior
 *     waypoints beyond the line are shifted. Orthogonal edges stay
 *     orthogonal unless an end docks on an untouched shape across the line
 *     (callers repair those, see incremental.ts)
 *   - an edge label follows the segment it belongs to (the one nearest to
 *     it): shifted when both ends of that segment were shifted, kept when
 *     neither was, and for a segment stretched by the line shifted when it
 *     lies beyond the line. So a label outside the `within` band (a message
 *     flow's label between two pools) goes with its flow
 *   - `within` restricts the effect to the band of that box on the other axis
 *     (a pool: its y-range for axis 'x'); default: the whole plane
 *   - `frame` (growing only; an expanded sub-process, or the sub-process
 *     being expanded, that the line crosses): room is made INSIDE that frame,
 *     and a frame never grows over anything that is not its content. The
 *     band is the frame's extent on the other axis. Inside the frame the
 *     rules above apply; the frame grows by `delta`. Everything outside it
 *     stays, its ancestors (parent sub-processes, lanes, pool) included,
 *     until one of two things happens (checked inside-out, repeatedly):
 *       · something that grew sticks out of an ancestor (closer than 10 px to
 *         its far border): that ancestor grows by `delta` too
 *       · a frame that grew (the frame or a grown ancestor) would cover, or
 *         come within 20 px of, a shape that stays and is neither its
 *         content nor its ancestor: the room is made one level further out
 *         instead, in the parent frame (the parent sub-process, else the
 *         pool, lanes never), whose content beyond the line all moves (rows
 *         of a branch stay together); above the pool the whole plane
 *     Connections between shapes outside the frame that stay are kept as
 *     they are
 *   - `keep` ids never move or resize
 *   Returns the ids of the moved and of the resized shapes.
 *
 *  closeStrip(plane, {axis, from, to, gap, within?, ignore?, keep?}) closes the strip
 *  [from, to] after a removal: everything beyond `to` moves back by the strip
 *  width minus one `gap`, unless something that stays (leaf shape, label,
 *  bend, container border, in the band of `within`) reaches into
 *  [from + gap, to], where the moved content lands. Returns the result, or
 *  undefined when it did not close.
 *
 *  shiftShape(plane, id, dx, dy) moves one shape rigidly: label, boundary
 *  events and their labels too.
 *
 *  fitInFrame(plane, id, pad?) grows the frames around a shape inside-out
 *  (sub-process frames with `frame`, so they never grow over foreign shapes).
 *  Above the shape itself, an ancestor that does not hold the centre of the
 *  frame inside it (a drawing with an event sub-process in another lane than
 *  its member lane) is skipped, never grown around it.
 */
import { layoutDebug, layoutDebugOn } from '../debug.js';
import { bottom, containsPoint, cx, cy, overlaps, right, type Box } from './geom.js';
import { boundariesOf, contentOf, frameOf, inFrame, isLeaf, type DShape, type Plane } from './plane.js';

export type Axis = 'x' | 'y';

export interface SpaceRequest {
  axis: Axis;
  line: number;
  delta: number;
  /** restrict to the band of this box on the other axis */
  within?: Box;
  /** growing only: the expanded sub-process the room is made in (see contract) */
  frame?: string;
  /** ids of shapes that never move or resize */
  keep?: ReadonlySet<string>;
  /**
   * the elements the room is made for (growing only): crossed expanded
   * sub-processes that hold none of them move rigidly or stay instead of growing
   */
  anchors?: ReadonlyArray<string | undefined>;
}

export interface SpaceResult {
  moved: Set<string>;
  resized: Set<string>;
}

type Decision = 'move' | 'resize' | 'stay';

/** room kept between a frame that grew and a shape outside it */
const FRAME_GAP = 20;
/** what a grown member keeps from the far border of an ancestor before that ancestor grows too */
const FRAME_PAD = 10;

const near = (b: Box, axis: Axis): number => (axis === 'x' ? b.x : b.y);
const far = (b: Box, axis: Axis): number => (axis === 'x' ? right(b) : bottom(b));

function shiftBox(b: Box, axis: Axis, d: number): void {
  if (axis === 'x') b.x += d;
  else b.y += d;
}

/** Moves one shape rigidly with its label, boundary events and their labels. */
export function shiftShape(plane: Plane, id: string, dx: number, dy: number): string[] {
  const s = plane.shapes.get(id);
  if (!s || (!dx && !dy)) return [];
  const moved = [id];
  const move = (t: DShape): void => {
    t.bounds.x += dx;
    t.bounds.y += dy;
    if (t.label) {
      t.label.x += dx;
      t.label.y += dy;
    }
  };
  move(s);
  for (const b of boundariesOf(plane, id)) {
    move(b);
    moved.push(b.id);
  }
  if (s.container && s.kind === 'subProcess') {
    const { shapes, edges } = contentOf(plane, id);
    for (const c of shapes) {
      move(c);
      moved.push(c.id);
    }
    const inside = new Set(shapes.map((c) => c.id));
    for (const e of edges) {
      if (!(e.sourceId && inside.has(e.sourceId)) || !(e.targetId && inside.has(e.targetId))) continue;
      for (const p of e.points) {
        p.x += dx;
        p.y += dy;
      }
      if (e.label) {
        e.label.x += dx;
        e.label.y += dy;
      }
    }
  }
  return moved;
}

function bandOf(within: Box | undefined, axis: Axis): [number, number] | undefined {
  if (!within) return undefined;
  return axis === 'x' ? [within.y, bottom(within)] : [within.x, right(within)];
}

/** centre of `b` on the other axis inside the band */
function centreInBand(b: Box, band: [number, number] | undefined, axis: Axis): boolean {
  if (!band) return true;
  const c = axis === 'x' ? b.y + b.height / 2 : b.x + b.width / 2;
  return c >= band[0] && c <= band[1];
}

function overlapsBand(b: Box, band: [number, number] | undefined, axis: Axis): boolean {
  if (!band) return true;
  const lo = axis === 'x' ? b.y : b.x;
  const hi = axis === 'x' ? bottom(b) : right(b);
  return lo < band[1] && hi > band[0];
}

function pointInBand(p: { x: number; y: number }, band: [number, number] | undefined, axis: Axis): boolean {
  if (!band) return true;
  const c = axis === 'x' ? p.y : p.x;
  return c >= band[0] - 1 && c <= band[1] + 1;
}

function resize(b: Box, axis: Axis, d: number): void {
  if (axis === 'x') b.width = Math.max(1, b.width + d);
  else b.height = Math.max(1, b.height + d);
}

/** Pools resized on x drag their lanes and the pools aligned with them along (shrinking only as far as their content allows). */
function alignPoolsAndLanes(plane: Plane, before: Map<string, Box>, res: SpaceResult): void {
  const pools = [...plane.shapes.values()].filter((s) => s.kind === 'participant');
  const grown = pools.filter((p) => res.resized.has(p.id));
  if (!grown.length) return;
  for (const g of grown) {
    const old = before.get(g.id)!;
    for (const p of pools) {
      if (p === g || res.resized.has(p.id) || res.moved.has(p.id)) continue;
      if (Math.abs(right(before.get(p.id)!) - right(old)) > 2) continue;
      // a pool shrinks along only as far as its own content (and message flows docking on it) allow
      const target = right(g.bounds);
      if (target < right(p.bounds)) {
        const content = [...plane.shapes.values()].filter((s) => s.poolId === p.id && s.kind !== 'lane').map((s) => right(s.bounds) + 15);
        const docks = [...plane.edges.values()].flatMap((e) => [e.sourceId === p.id ? e.points[0] : undefined, e.targetId === p.id ? e.points[e.points.length - 1] : undefined]).filter((q): q is { x: number; y: number } => !!q).map((q) => q.x + 15);
        if (Math.max(-Infinity, ...content, ...docks) > target) continue;
      }
      p.bounds.width = target - p.bounds.x;
      res.resized.add(p.id);
    }
  }
  for (const lane of plane.shapes.values()) {
    if (lane.kind !== 'lane' || !lane.poolId) continue;
    const pool = plane.shapes.get(lane.poolId);
    const oldPool = pool && before.get(pool.id);
    const oldLane = before.get(lane.id);
    if (!pool || !oldPool || !oldLane || !res.resized.has(pool.id)) continue;
    if (Math.abs(right(oldLane) - right(oldPool)) <= 2 && Math.abs(right(lane.bounds) - right(pool.bounds)) > 0.5) {
      lane.bounds.width = right(pool.bounds) - lane.bounds.x;
      res.resized.add(lane.id);
    }
  }
}

/** The box reaches beyond the band on the other axis (it holds content the band does not cover). */
function beyondBand(b: Box, band: [number, number] | undefined, axis: Axis): boolean {
  if (!band) return false;
  const lo = axis === 'x' ? b.y : b.x;
  const hi = axis === 'x' ? bottom(b) : right(b);
  return lo < band[0] - 1 || hi > band[1] + 1;
}

/**
 * The pool a shape without semantic pool sits in (a collaboration-level
 * annotation, group content): the pool containing its centre.
 */
function geometricPool(plane: Plane, s: DShape, before: ReadonlyMap<string, Box>): string | undefined {
  if (s.poolId || s.kind === 'participant' || s.kind === 'lane' || s.kind === 'group' || s.hostId || s.parentId) return s.poolId;
  const c = { x: s.bounds.x + s.bounds.width / 2, y: s.bounds.y + s.bounds.height / 2 };
  for (const p of plane.shapes.values()) {
    if (p.kind !== 'participant') continue;
    const b = before.get(p.id) ?? p.bounds;
    if (c.x >= b.x && c.x <= right(b) && c.y >= b.y && c.y <= bottom(b)) return p.id;
  }
  return undefined;
}

/**
 * A shrunk container never ends before its own content: its far border stays
 * at least `pad` beyond every member (leaf shapes and expanded sub-processes
 * whose frame chain contains it), and never moves out further than before.
 */
function capShrink(plane: Plane, c: DShape, axis: Axis, before: Box, pad = 10): void {
  let need = -Infinity;
  for (const s of plane.shapes.values()) {
    if (s === c || s.kind === 'participant' || s.kind === 'lane' || s.kind === 'group') continue;
    if (!inFrame(plane, s, c)) continue;
    need = Math.max(need, far(s.bounds, axis) + (s.kind === 'boundary' ? 0 : pad));
  }
  const limit = Math.min(need, far(before, axis));
  if (far(c.bounds, axis) >= limit) return;
  if (axis === 'x') c.bounds.width = limit - c.bounds.x;
  else c.bounds.height = limit - c.bounds.y;
}

/**
 * The expanded sub-processes that hold one of `anchors` (the anchor itself
 * when it is one, its parent chain, a boundary event's host's chain).
 */
function holders(plane: Plane, anchors: ReadonlyArray<string | undefined>): Set<string> {
  const out = new Set<string>();
  for (const id of anchors) {
    let cur = id ? plane.shapes.get(id) : undefined;
    if (cur?.hostId) cur = plane.shapes.get(cur.hostId) ?? cur;
    for (let i = 0; cur && i < 20; i++) {
      out.add(cur.id);
      cur = cur.parentId ? plane.shapes.get(cur.parentId) : undefined;
    }
  }
  return out;
}

/** Index of the segment of `pts` nearest to the centre of `b`. */
function nearestSegment(pts: ReadonlyArray<{ x: number; y: number }>, b: Box): number {
  const c = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  let best = 0;
  let dist = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const p = pts[i]!;
    const q = pts[i + 1]!;
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const len = dx * dx + dy * dy;
    const t = len ? Math.max(0, Math.min(1, ((c.x - p.x) * dx + (c.y - p.y) * dy) / len)) : 0;
    const d = Math.hypot(c.x - (p.x + t * dx), c.y - (p.y + t * dy));
    if (d < dist - 1e-9) {
      dist = d;
      best = i;
    }
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* one pass: decisions, then applying them                              */
/* ------------------------------------------------------------------ */

/** Frame mode (see contract): the frame the room is made in and what lies around it. */
interface FrameScope {
  frame: DShape;
  /** the frame chain around `frame` (parent sub-processes, lanes, pool) */
  ancestors: Set<string>;
  /** ancestors that grow because what grew inside sticks out of them */
  grow: Set<string>;
}

interface Pass {
  plane: Plane;
  axis: Axis;
  line: number;
  delta: number;
  band: [number, number] | undefined;
  keep: ReadonlySet<string>;
  /** bounds of every shape before the run */
  before: Map<string, Box>;
  /** holders of the anchors (growing for an anchor only) */
  held: Set<string> | undefined;
  scope?: FrameScope;
}

/** The frame chain of a shape (a boundary event: its host's), innermost first. */
function frameChain(plane: Plane, s: DShape): DShape[] {
  const out: DShape[] = [];
  let cur = s.hostId ? plane.shapes.get(s.hostId) ?? s : s;
  if (cur !== s) out.push(cur);
  for (let i = 0; i < 16; i++) {
    const f = frameOf(plane, cur);
    if (!f || out.includes(f)) break;
    out.push(f);
    cur = f;
  }
  return out;
}

/** A crossed expanded sub-process that does not hold the anchor: moved or kept as a whole. */
function rigid(p: Pass, c: DShape): boolean {
  if (!p.held || c.kind !== 'subProcess' || !c.container || p.held.has(c.id) || p.keep.has(c.id)) return false;
  const b = p.before.get(c.id)!;
  return near(b, p.axis) < p.line && far(b, p.axis) > p.line && overlapsBand(b, p.band, p.axis);
}

/** The outermost rigid sub-process around `s` (its parent chain). */
function rigidAround(p: Pass, s: DShape): DShape | undefined {
  let out: DShape | undefined;
  let cur = s.parentId ? p.plane.shapes.get(s.parentId) : undefined;
  for (let i = 0; cur && i < 20; i++) {
    if (rigid(p, cur)) out = cur;
    cur = cur.parentId ? p.plane.shapes.get(cur.parentId) : undefined;
  }
  return out;
}

/** In frame mode: the shape is content of the frame (by its frame chain, or drawn inside it). */
function insideFrame(p: Pass, s: DShape): boolean {
  const scope = p.scope!;
  if (frameChain(p.plane, s).includes(scope.frame)) return true;
  if (s.container || s.kind === 'group' || scope.ancestors.has(s.id)) return false;
  const b = p.before.get(s.id)!;
  const f = p.before.get(scope.frame.id)!;
  const c = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  return c.x > f.x && c.x < right(f) && c.y > f.y && c.y < bottom(f);
}

/** Frame mode: 'stay' / 'resize' for what lies outside the frame, undefined for the frame and its content (the usual rules). */
function scopeDecision(p: Pass, s: DShape): Decision | undefined {
  const scope = p.scope;
  if (!scope || s === scope.frame || insideFrame(p, s)) return undefined;
  if (!scope.ancestors.has(s.id) || !scope.grow.has(s.id)) return 'stay';
  const b = p.before.get(s.id)!;
  return near(b, p.axis) < p.line && far(b, p.axis) > p.line ? 'resize' : 'stay';
}

/** Every shape's decision, top-down: the content of a container beyond the line goes with its container. */
function decideAll(p: Pass): Map<string, Decision> {
  const { plane, axis, line, delta, band, keep, before } = p;
  const decision = new Map<string, Decision>();
  const decide = (s: DShape, depth = 0): Decision => {
    const known = decision.get(s.id);
    if (known) return known;
    let d: Decision = 'stay';
    const host = s.hostId ? plane.shapes.get(s.hostId) : undefined;
    // the outermost container (pool, lane, expanded sub-process) entirely beyond the line carries its content;
    // collaboration-level artifacts go with the pool they are drawn in
    const carrier = [s.kind === 'participant' ? undefined : geometricPool(plane, s, before), s.laneId, s.parentId]
      .map((id) => (id ? plane.shapes.get(id) : undefined))
      .find((c) => !!c && near(before.get(c.id)!, axis) >= line);
    const hostDecision = host && depth < 20 ? decide(host, depth + 1) : undefined;
    const scoped = host ? undefined : scopeDecision(p, s);
    const block = p.held && !host && !carrier ? rigidAround(p, s) : undefined;
    if (keep.has(s.id)) d = 'stay';
    else if (host && hostDecision && (!host.container || hostDecision !== 'resize')) {
      // boundary events follow a leaf host and a container moved as a whole
      d = hostDecision === 'move' ? 'move' : 'stay';
    } else if (host && hostDecision === 'resize') {
      // on a resized container they stay on its border: the part of the border beyond the line moves
      const eb = before.get(s.id)!;
      d = (axis === 'x' ? eb.x + eb.width / 2 : eb.y + eb.height / 2) >= line ? 'move' : 'stay';
    } else if (scoped) {
      d = scoped;
    } else if (carrier && depth < 20) {
      d = decide(carrier, depth + 1) === 'move' ? 'move' : 'stay';
    } else if (block && depth < 20) {
      // inside a sub-process the line crosses without holding the anchor: with it, as a whole
      d = decide(block, depth + 1) === 'move' ? 'move' : 'stay';
    } else if (rigid(p, s)) {
      const b = before.get(s.id)!;
      d = (axis === 'x' ? b.x + b.width / 2 : b.y + b.height / 2) >= line ? 'move' : 'stay';
    } else {
      const ref = before.get(s.id)!;
      if (near(ref, axis) >= line) d = overlapsBand(ref, band, axis) ? 'move' : 'stay';
      else if ((s.container || s.kind === 'group') && far(ref, axis) > line && overlapsBand(ref, band, axis)) {
        // closing space (negative delta) inside a band shrinks only the containers inside it: a pool or lane
        // reaching beyond the band (around the sub-process the band belongs to) holds content that stays
        d = delta < 0 && beyondBand(ref, band, axis) ? 'stay' : 'resize';
      }
    }
    decision.set(s.id, d);
    return d;
  };
  for (const s of plane.shapes.values()) decide(s);
  return decision;
}

/** Applies the decisions of a pass: shapes, then connections and their labels (see contract). */
function applyPass(p: Pass, decision: ReadonlyMap<string, Decision>): SpaceResult {
  const { plane, axis, line, delta, band, keep, before } = p;
  const res: SpaceResult = { moved: new Set(), resized: new Set() };
  for (const s of plane.shapes.values()) {
    const d = decision.get(s.id);
    if (d === 'move') {
      shiftBox(s.bounds, axis, delta);
      if (s.label) shiftBox(s.label, axis, delta);
      res.moved.add(s.id);
    } else if (d === 'resize') {
      resize(s.bounds, axis, delta);
      res.resized.add(s.id);
    }
  }
  if (delta < 0) for (const id of res.resized) {
    const c = plane.shapes.get(id)!;
    if (c.container) capShrink(plane, c, axis, before.get(id)!);
  }
  if (axis === 'x') alignPoolsAndLanes(plane, before, res);

  // the members of every rigid sub-process (itself, its content, their boundary events): their inner
  // connections are translated as a whole or kept as they are
  const blockOf = new Map<string, string>();
  if (p.held) {
    for (const s of plane.shapes.values()) {
      if (!rigid(p, s) || rigidAround(p, s)) continue;
      blockOf.set(s.id, s.id);
      for (const b of boundariesOf(plane, s.id)) blockOf.set(b.id, s.id);
      for (const c of contentOf(plane, s.id).shapes) blockOf.set(c.id, s.id);
    }
  }
  const changed = (id: string | undefined): boolean => !!id && (res.moved.has(id) || res.resized.has(id));
  /** frame mode: an end outside the frame (it stays, held by the frame chain around it) */
  const outside = (id: string | undefined): boolean => {
    const s = id ? plane.shapes.get(id) : undefined;
    return !s || (s !== p.scope!.frame && !insideFrame(p, s));
  };

  for (const e of plane.edges.values()) {
    // a connection between shapes that stay on request stays as it is
    if (e.sourceId && e.targetId && keep.has(e.sourceId) && keep.has(e.targetId)) continue;
    // frame mode: a connection between shapes outside the frame that stay stays as it is
    if (p.scope && !changed(e.sourceId) && !changed(e.targetId) && outside(e.sourceId) && outside(e.targetId)) continue;
    const n = e.points.length;
    const block = e.sourceId && e.targetId ? blockOf.get(e.sourceId) : undefined;
    const inBlock = !!block && blockOf.get(e.targetId!) === block;
    const seg = e.label && n >= 2 ? nearestSegment(e.points, e.label) : -1;
    const shifted: boolean[] = [];
    e.points.forEach((pt, i) => {
      const endId = i === 0 ? e.sourceId : i === n - 1 ? e.targetId : undefined;
      const end = endId ? plane.shapes.get(endId) : undefined;
      const beyond = (axis === 'x' ? pt.x : pt.y) >= line;
      let shift: boolean;
      if (inBlock) shift = res.moved.has(block);
      else if (end && res.moved.has(end.id)) shift = true;
      else if (end && res.resized.has(end.id)) shift = beyond; // docked on a grown border (also an aligned pool outside the band)
      else if (end) shift = false;
      else shift = beyond && pointInBand(pt, band, axis);
      shifted.push(shift);
      if (shift) {
        if (axis === 'x') pt.x += delta;
        else pt.y += delta;
      }
    });
    if (!e.label) continue;
    // the label goes with the segment it belongs to
    const a = seg >= 0 ? shifted[seg] : undefined;
    const b = seg >= 0 ? shifted[seg + 1] : undefined;
    const follow = a !== undefined && a === b ? a : near(e.label, axis) >= line && (seg >= 0 || centreInBand(e.label, band, axis));
    if (follow) shiftBox(e.label, axis, delta);
  }
  return res;
}

/* ------------------------------------------------------------------ */
/* frame mode                                                           */
/* ------------------------------------------------------------------ */

/** Ancestors that something grown now sticks out of (rule 1 of frame mode). */
function outgrown(p: Pass, decision: ReadonlyMap<string, Decision>): string[] {
  const scope = p.scope!;
  const out = new Set<string>();
  for (const s of p.plane.shapes.values()) {
    const d = decision.get(s.id);
    if (d !== 'move' && d !== 'resize') continue;
    const reach = far(p.before.get(s.id)!, p.axis) + p.delta + (s.kind === 'boundary' || s.kind === 'lane' ? 0 : FRAME_PAD);
    for (const a of frameChain(p.plane, s)) {
      if (!scope.ancestors.has(a.id) || scope.grow.has(a.id) || out.has(a.id)) continue;
      if (reach > far(p.before.get(a.id)!, p.axis) + 0.5) out.add(a.id);
    }
  }
  return [...out];
}

/** The strip a frame grows into (its far border plus `delta` and the gap), over its extent on the other axis. */
function growthRegion(p: Pass, b: Box): Box {
  const from = far(b, p.axis);
  const len = p.delta + FRAME_GAP;
  return p.axis === 'x' ? { x: from, y: b.y, width: len, height: b.height } : { x: b.x, y: from, width: b.width, height: len };
}

/** Frames that grew over something that stays (rule 2 of frame mode). */
function swallowers(p: Pass, decision: ReadonlyMap<string, Decision>): DShape[] {
  const scope = p.scope!;
  const out: DShape[] = [];
  for (const r of p.plane.shapes.values()) {
    if (decision.get(r.id) !== 'resize' || (r !== scope.frame && !scope.grow.has(r.id))) continue;
    const rb = p.before.get(r.id)!;
    const region = growthRegion(p, rb);
    const around = new Set(frameChain(p.plane, r).map((f) => f.id));
    const hit = [...p.plane.shapes.values()].some((s) => {
      if (s === r || s.kind === 'group' || p.keep.has(s.id) || decision.get(s.id) !== 'stay' || around.has(s.id) || s.hostId === r.id) return false;
      if (frameChain(p.plane, s).includes(r)) return false;
      const sb = p.before.get(s.id)!;
      return overlaps(sb, region) && !overlaps(sb, rb);
    });
    if (hit) out.push(r);
  }
  return out;
}

/** The frame one level further out (the parent sub-process, else the pool; lanes never; undefined: the plane). */
function frameUp(plane: Plane, r: DShape): DShape | undefined {
  if (r.kind === 'participant') return undefined;
  const parent = r.kind === 'subProcess' && r.parentId ? plane.shapes.get(r.parentId) : undefined;
  if (parent) return parent;
  return r.poolId ? plane.shapes.get(r.poolId) : undefined;
}

/** The scope one level out from the frames that grew over something (undefined: the whole plane). */
function widen(plane: Plane, scope: FrameScope, grown: DShape[]): FrameScope | undefined {
  const targets = grown.map((r) => frameUp(plane, r));
  if (targets.some((t) => !t)) return undefined;
  // the outermost of them: the one with the shortest frame chain
  const next = (targets as DShape[]).sort((a, b) => frameChain(plane, a).length - frameChain(plane, b).length)[0]!;
  return scopeFor(plane, next, scope.grow);
}

function scopeFor(plane: Plane, frame: DShape, grow: Set<string> = new Set()): FrameScope {
  const ancestors = new Set(frameChain(plane, frame).map((f) => f.id));
  return { frame, ancestors, grow: new Set([...grow].filter((id) => ancestors.has(id))) };
}

/** Frame mode (see contract): room inside a frame, made one level further out where the frame would grow over something. */
function spaceInFrame(plane: Plane, base: Omit<Pass, 'band' | 'scope'>, frame: DShape): SpaceResult {
  let scope: FrameScope | undefined = scopeFor(plane, frame);
  for (let guard = 0; scope && guard < 40; guard++) {
    const pass: Pass = { ...base, band: bandOf(base.before.get(scope.frame.id)!, base.axis), scope };
    const decision = decideAll(pass);
    const grow = outgrown(pass, decision);
    if (grow.length) {
      grow.forEach((id) => scope!.grow.add(id));
      continue;
    }
    const over = swallowers(pass, decision);
    if (!over.length) return applyPass(pass, decision);
    if (layoutDebugOn()) layoutDebug(`[space] ${over.map((r) => r.id).join(',')} would grow over a shape: room one level out`);
    scope = widen(plane, scope, over);
  }
  // above the outermost frame: the whole plane
  const pass: Pass = { ...base, band: undefined };
  return applyPass(pass, decideAll(pass));
}

/** The space tool (see module contract). */
export function makeSpace(plane: Plane, req: SpaceRequest): SpaceResult {
  const { axis, line, delta } = req;
  if (!delta) return { moved: new Set(), resized: new Set() };
  const before = new Map<string, Box>();
  for (const s of plane.shapes.values()) before.set(s.id, { ...s.bounds });
  const keep = req.keep ?? new Set<string>();
  // growing for an anchor: crossed expanded sub-processes that do not hold it are rigid (moved or kept whole)
  const held = req.anchors && delta > 0 ? holders(plane, req.anchors) : undefined;
  const base = { plane, axis, line, delta, keep, before, held };
  const frame = req.frame ? plane.shapes.get(req.frame) : undefined;
  const fb = frame && before.get(frame.id)!;
  if (frame && fb && frame.container && delta > 0 && near(fb, axis) < line && far(fb, axis) > line) return spaceInFrame(plane, base, frame);
  const within = req.within ?? (frame ? frame.bounds : undefined);
  const pass: Pass = { ...base, band: bandOf(within, axis) };
  return applyPass(pass, decideAll(pass));
}

/** The box of a shape together with its boundary events. */
export function unitBox(plane: Plane, s: DShape): Box {
  let b = { ...s.bounds };
  for (const be of boundariesOf(plane, s.id)) {
    const x = Math.min(b.x, be.bounds.x);
    const y = Math.min(b.y, be.bounds.y);
    b = { x, y, width: Math.max(right(b), right(be.bounds)) - x, height: Math.max(bottom(b), bottom(be.bounds)) - y };
  }
  return b;
}

/**
 * Where a frame grows: a sub-process in frame mode (it never grows over
 * foreign shapes), a pool / lane on x within its pool, on y over the plane.
 */
function growthScope(plane: Plane, frame: DShape, axis: Axis): { within?: Box; frame?: string } {
  if (frame.kind === 'subProcess' && frame.container) return { frame: frame.id };
  if (axis === 'y') return {};
  if (frame.kind === 'participant') return withinOf(frame.bounds);
  return withinOf(frame.poolId ? plane.shapes.get(frame.poolId)?.bounds : undefined);
}

/**
 * Grows the frames around a shape (innermost first, then outwards) until it
 * sits inside each with `pad` on the right and at the bottom. Content beyond
 * the grown border makes room like with the space tool, except the shapes in
 * `keep` (e.g. the rest of a group moved together). Returns everything moved
 * or resized.
 */
export function fitInFrame(plane: Plane, id: string, pad = 15, frameFn: (s: DShape) => DShape | undefined = (s) => frameOf(plane, s), keepAlso: Iterable<string> = []): SpaceResult {
  const out: SpaceResult = { moved: new Set(), resized: new Set() };
  const merge = (r: SpaceResult): void => {
    r.moved.forEach((x) => out.moved.add(x));
    r.resized.forEach((x) => out.resized.add(x));
  };
  let inner = plane.shapes.get(id);
  // the shape stays with its boundary events and, for an expanded sub-process, its content
  const content = inner?.kind === 'subProcess' && inner.container ? contentOf(plane, id).shapes.map((c) => c.id) : [];
  const keep = new Set([id, ...boundariesOf(plane, id).map((b) => b.id), ...content, ...keepAlso]);
  for (let guard = 0; inner && guard < 8; guard++) {
    let frame = frameFn(inner);
    // an ancestor the drawing does not put the inner frame into (its centre lies outside, e.g. an event
    // sub-process drawn in another lane) is skipped: growing it would move the inner frame away from the shape
    while (frame && guard > 0 && !containsPoint(frame.bounds, { x: cx(inner.bounds), y: cy(inner.bounds) })) frame = frameFn(frame);
    if (!frame) break;
    // pools and lanes by their bounds; anything else with its boundary events (also an expanded sub-process)
    const box = inner.kind === 'participant' || inner.kind === 'lane' ? inner.bounds : unitBox(plane, inner);
    // lanes sit flush in their pool / parent lane; everything else keeps `pad`
    const p = inner.kind === 'lane' ? 0 : pad;
    const overRight = right(box) + p - right(frame.bounds);
    if (overRight > 0.5) merge(makeSpace(plane, { axis: 'x', line: right(frame.bounds) - 1, delta: Math.ceil(overRight), keep, anchors: [id], ...growthScope(plane, frame, 'x') }));
    const overBottom = bottom(box) + p - bottom(frame.bounds);
    if (overBottom > 0.5) merge(makeSpace(plane, { axis: 'y', line: bottom(frame.bounds) - 1, delta: Math.ceil(overBottom), keep, anchors: [id], ...growthScope(plane, frame, 'y') }));
    inner = frame;
  }
  return out;
}

function withinOf(b: Box | undefined): { within?: Box } {
  return b ? { within: { ...b } } : {};
}

export interface StripRequest {
  axis: Axis;
  from: number;
  to: number;
  /** the gap that stays where the strip was */
  gap: number;
  within?: Box;
  /** edges whose bends do not count (they are rerouted anyway) */
  ignore?: ReadonlySet<string>;
  /** shapes that never move or resize (makeSpace `keep`) */
  keep?: ReadonlySet<string>;
}

/** Closes an empty strip (see module contract). */
export function closeStrip(plane: Plane, req: StripRequest): SpaceResult | undefined {
  const { axis, from, to, gap } = req;
  const width = to - from;
  if (width - gap <= 0) return undefined;
  const band = bandOf(req.within, axis);
  // after the close, what lies beyond `to` covers [from + gap, ...): only what stays there blocks it
  // (a neighbour's label reaching a few px into the strip does not)
  // content starting a few px before `to` (a slightly smaller gap in the drawing) moves too
  const tol = 3;
  const line = to - tol;
  const lo = from + gap + tol;
  const hi = line;
  const blocks = (b: Box): boolean => near(b, axis) < hi && far(b, axis) > lo && overlapsBand(b, band, axis);
  for (const s of plane.shapes.values()) {
    const owner = s.hostId ? plane.shapes.get(s.hostId) ?? s : s;
    const stays = near(owner.bounds, axis) < line;
    if (isLeaf(s) && stays && blocks(s.bounds)) return undefined;
    if (s.label && stays && blocks(s.label)) return undefined;
    if (s.container && overlapsBand(s.bounds, band, axis)) {
      const a = near(s.bounds, axis);
      const b = far(s.bounds, axis);
      if ((a > lo && a < hi) || (b > lo && b < hi)) return undefined;
    }
  }
  for (const e of plane.edges.values()) {
    if (req.ignore?.has(e.id)) continue;
    if (e.label && blocks(e.label)) return undefined;
    for (let i = 1; i + 1 < e.points.length; i++) {
      const p = e.points[i]!;
      const c = axis === 'x' ? p.x : p.y;
      if (c > lo && c < hi && pointInBand(p, band, axis)) return undefined;
    }
  }
  return makeSpace(plane, { axis, line, delta: -(width - gap), ...(req.within ? { within: req.within } : {}), ...(req.keep ? { keep: req.keep } : {}) });
}
