/**
 * Pools, lanes and sub-process expansion in a kept drawing.
 *
 * CONTRACT
 *  - wrapPool(plane, participant): the first pool around a process diagram
 *    encloses all existing content (30 px header, 30 px padding).
 *  - placePool(plane, participant, size?): a new pool below the last pool,
 *    as wide as the widest pool (gap: the median gap between pools, else 80);
 *    black boxes are 60 px high, other new pools 200 px (or `size`).
 *  - placeLane(plane, lane, sem): the first lane of a pool / parent lane takes
 *    its whole band (right of the 30 px header); further lanes are appended at
 *    the bottom (height: median sibling lane height, else 150), the pool and
 *    parent lanes grow and everything below moves down.
 *  - removedLane(plane, box, poolId): an empty band closes (lanes below move
 *    up, the pool shrinks); a band that still holds shapes is taken over by
 *    the sibling lane above (or below); the only lane of a pool / parent lane
 *    leaves its frame as it is (the band is the whole frame).
 *  - removedPool(plane, box): pools below move up into the freed band.
 *  - collapse(plane, sub, childPlane) / expand(plane, sub, childPlane?): turn
 *    an expanded sub-process into a collapsed one (content moves to its own
 *    plane, keeping relative positions; the freed strip closes) and back
 *    (content of the child plane moves in, the sub-process grows to fit
 *    right, then down, making room with the space tool in frame mode: it
 *    never grows over foreign shapes, see space.ts).
 *  - reseatBoundaries(plane, host, old): after the host's box changed (collapse,
 *    expand, a sub-process retyped to a task) its boundary events sit on the
 *    same border as before, in the same order, with their labels.
 *  Every function returns the ids it moved or resized.
 */
import { SIZES } from '../layout/types.js';
import { bottom, copyBox, cy, median, right, type Box } from './geom.js';
import { boundariesOf, contentOf, isLeaf, type DEdge, type DShape, type Plane, type Semantics } from './plane.js';

export { contentOf };
import { closeStrip, makeSpace, type SpaceResult } from './space.js';

const HEADER = 30;
const PAD = 30;

function merge(into: Set<string>, r: SpaceResult | undefined): void {
  if (!r) return;
  r.moved.forEach((x) => into.add(x));
  r.resized.forEach((x) => into.add(x));
}

export function pools(plane: Plane): DShape[] {
  return [...plane.shapes.values()].filter((s) => s.kind === 'participant');
}

/** The first pool around a process diagram: all existing content inside. */
export function wrapPool(plane: Plane, pool: DShape): void {
  let box: Box | undefined;
  for (const s of plane.shapes.values()) {
    if (s === pool) continue;
    const parts = [s.bounds, ...(s.label ? [s.label] : [])];
    for (const b of parts) box = box ? union(box, b) : copyBox(b);
  }
  for (const e of plane.edges.values()) for (const p of e.points) box = box ? union(box, { x: p.x, y: p.y, width: 0, height: 0 }) : { x: p.x, y: p.y, width: 0, height: 0 };
  pool.bounds = box ? { x: Math.round(box.x - HEADER - PAD), y: Math.round(box.y - PAD), width: Math.round(box.width + HEADER + 2 * PAD), height: Math.round(box.height + 2 * PAD) } : { x: 100, y: 80, width: 600, height: 250 };
}

function union(a: Box, b: Box): Box {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(right(a), right(b)) - x, height: Math.max(bottom(a), bottom(b)) - y };
}

/** A new pool below the last one. */
export function placePool(plane: Plane, pool: DShape, blackBox: boolean, size?: { width: number; height: number }): void {
  const others = pools(plane).filter((p) => p !== pool);
  const height = size?.height ?? (blackBox ? SIZES.blackBoxHeight : 200);
  if (!others.length) {
    let content: Box | undefined;
    for (const s of plane.shapes.values()) if (s !== pool) content = content ? union(content, s.bounds) : copyBox(s.bounds);
    const x = content ? content.x - HEADER - PAD : 100;
    const y = content ? bottom(content) + 80 : 80;
    pool.bounds = { x: Math.round(x), y: Math.round(y), width: Math.round(size?.width ?? Math.max(600, content ? content.width + HEADER + 2 * PAD : 600)), height };
    return;
  }
  const sorted = [...others].sort((a, b) => a.bounds.y - b.bounds.y);
  const gaps: number[] = [];
  for (let i = 0; i + 1 < sorted.length; i++) gaps.push(sorted[i + 1]!.bounds.y - bottom(sorted[i]!.bounds));
  const gap = Math.max(0, Math.round(median(gaps.filter((g) => g >= 0)) ?? 80));
  const widest = [...others].sort((a, b) => b.bounds.width - a.bounds.width || a.bounds.x - b.bounds.x)[0]!;
  const lowest = Math.max(...others.map((p) => bottom(p.bounds)));
  pool.bounds = { x: widest.bounds.x, y: Math.round(lowest + gap), width: Math.max(widest.bounds.width, size?.width ?? 0), height };
}

/** Lane shapes that are children of `parentId` (a lane id, or undefined for the pool's top level). */
function siblingLanes(plane: Plane, poolId: string | undefined, parentId: string | undefined, except: string): DShape[] {
  return [...plane.shapes.values()].filter((s) => s.kind === 'lane' && s.id !== except && s.poolId === poolId && s.laneId === parentId).sort((a, b) => a.bounds.y - b.bounds.y);
}

/** Ancestors of a lane / pool container: parent lanes and the pool. */
function containerChain(plane: Plane, c: DShape): DShape[] {
  const out: DShape[] = [];
  let cur: DShape | undefined = c;
  for (let i = 0; cur && i < 10; i++) {
    out.push(cur);
    cur = cur.kind === 'lane' ? (cur.laneId ? plane.shapes.get(cur.laneId) : cur.poolId ? plane.shapes.get(cur.poolId) : undefined) : undefined;
  }
  return out;
}

/** Draws a new lane (see module contract); false when its pool is not drawn. */
export function placeLane(plane: Plane, lane: DShape, touched: Set<string>): boolean {
  const container = lane.laneId ? plane.shapes.get(lane.laneId) : lane.poolId ? plane.shapes.get(lane.poolId) : undefined;
  if (!container) return false;
  const siblings = siblingLanes(plane, lane.poolId, lane.laneId, lane.id);
  const cb = container.bounds;
  if (!siblings.length) {
    lane.bounds = { x: cb.x + HEADER, y: cb.y, width: cb.width - HEADER, height: cb.height };
    return true;
  }
  const height = Math.round(median(siblings.map((s) => s.bounds.height)) ?? 150) || 150;
  const line = bottom(cb);
  const chain = containerChain(plane, container);
  const before = new Map(chain.map((c) => [c.id, bottom(c.bounds)]));
  const band = lane.poolId ? plane.shapes.get(lane.poolId)?.bounds : undefined;
  merge(touched, makeSpace(plane, { axis: 'y', line, delta: height, ...(band ? { within: { ...band } } : {}) }));
  for (const c of chain) {
    if (Math.abs(before.get(c.id)! - line) <= 1 && bottom(c.bounds) < line + height - 0.5) {
      c.bounds.height += height;
      touched.add(c.id);
    }
  }
  const ref = siblings[siblings.length - 1]!;
  lane.bounds = { x: ref.bounds.x, y: line, width: ref.bounds.width, height };
  return true;
}

/** A lane was removed: close its band when empty, else let a sibling take it over. */
export function removedLane(plane: Plane, box: Box, poolId: string | undefined, parentId: string | undefined, touched: Set<string>): void {
  const pool = poolId ? plane.shapes.get(poolId) : undefined;
  const occupied = [...plane.shapes.values()].some((s) => isLeaf(s) && s.kind !== 'boundary' && cy(s.bounds) > box.y && cy(s.bounds) < bottom(box) && (!pool || (s.bounds.x >= pool.bounds.x && s.bounds.x <= right(pool.bounds))));
  const siblings = siblingLanes(plane, poolId, parentId, '');
  // the only lane of its pool / parent lane: the band is the whole frame, which keeps its size (audit #39)
  if (!siblings.length) return;
  if (!occupied) {
    merge(touched, makeSpace(plane, { axis: 'y', line: bottom(box) - 0.5, delta: -box.height, ...(pool ? { within: { ...pool.bounds } } : {}) }));
    return;
  }
  const above = siblings.find((s) => Math.abs(bottom(s.bounds) - box.y) <= 1);
  const below = siblings.find((s) => Math.abs(s.bounds.y - bottom(box)) <= 1);
  if (above) {
    above.bounds.height += box.height;
    touched.add(above.id);
  } else if (below) {
    below.bounds.y -= box.height;
    below.bounds.height += box.height;
    touched.add(below.id);
  }
}

/** A pool was removed: pools below move up into its band. */
export function removedPool(plane: Plane, box: Box, touched: Set<string>): void {
  const below = pools(plane).filter((p) => p.bounds.y >= bottom(box) - 1);
  if (!below.length) return;
  const next = Math.min(...below.map((p) => p.bounds.y));
  const occupied = [...plane.shapes.values()].some((s) => s.kind !== 'participant' && cy(s.bounds) > box.y && cy(s.bounds) < next);
  if (occupied) return;
  merge(touched, makeSpace(plane, { axis: 'y', line: next - 0.5, delta: -(next - box.y) }));
}

/* ------------------------------------------------------------------ */
/* expansion                                                            */
/* ------------------------------------------------------------------ */

function shiftAll(shapes: DShape[], edges: DEdge[], dx: number, dy: number): void {
  for (const s of shapes) {
    s.bounds.x += dx;
    s.bounds.y += dy;
    if (s.label) {
      s.label.x += dx;
      s.label.y += dy;
    }
  }
  for (const e of edges) {
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

/**
 * Puts the boundary events of a host whose box changed from `old` to its
 * current bounds back on its border: each keeps its side and its distance
 * from the side's far corner (right / bottom) when that still fits, else the
 * events of that side are spread from the far corner in their old order, and
 * what does not fit moves to the opposite side. Labels move with their event.
 */
export function reseatBoundaries(plane: Plane, host: DShape, old: Box, touched: Set<string>): void {
  const events = boundariesOf(plane, host.id);
  if (!events.length) return;
  const nb = host.bounds;
  type Side = 'top' | 'bottom' | 'left' | 'right';
  const sideOf = (b: Box): Side => {
    const c = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    const d: Array<[Side, number]> = [
      ['bottom', Math.abs(c.y - bottom(old))],
      ['right', Math.abs(c.x - right(old))],
      ['top', Math.abs(c.y - old.y)],
      ['left', Math.abs(c.x - old.x)],
    ];
    return d.reduce((a, b2) => (b2[1] < a[1] ? b2 : a))[0];
  };
  const horizontal = (side: Side): boolean => side === 'top' || side === 'bottom';
  const opposite: Record<Side, Side> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };
  const along = (b: Box, side: Side): number => (horizontal(side) ? b.x + b.width / 2 : b.y + b.height / 2);
  const span = (box: Box, side: Side): [number, number] => (horizontal(side) ? [box.x, right(box)] : [box.y, bottom(box)]);
  const bySide = new Map<Side, DShape[]>();
  for (const e of events) {
    const side = sideOf(e.bounds);
    bySide.set(side, [...(bySide.get(side) ?? []), e]);
  }
  const placed = new Map<DShape, { side: Side; c: number }>();
  const overflow: Array<[Side, DShape]> = [];
  const fit = (side: Side, list: DShape[], keepOffsets: boolean): void => {
    const sorted = [...list].sort((a, b) => along(a.bounds, side) - along(b.bounds, side));
    const [lo, hi] = span(nb, side);
    const size = (e: DShape): number => (horizontal(side) ? e.bounds.width : e.bounds.height);
    const taken = [...placed.entries()].filter(([, p]) => p.side === side);
    const free = (c: number, e: DShape): boolean => c - size(e) / 2 >= lo - 0.5 && c + size(e) / 2 <= hi + 0.5 && taken.every(([o, p]) => Math.abs(p.c - c) >= (size(o) + size(e)) / 2 + 4);
    if (keepOffsets) {
      const [, oldHi] = span(old, side);
      const cs = sorted.map((e) => hi - (oldHi - along(e.bounds, side)));
      const ok = sorted.every((e, i) => free(cs[i]!, e) && sorted.every((o, j) => j === i || Math.abs(cs[j]! - cs[i]!) >= (size(o) + size(e)) / 2 + 4));
      if (ok) {
        sorted.forEach((e, i) => placed.set(e, { side, c: cs[i]! }));
        return;
      }
    }
    // spread from the far corner, the rightmost / lowest event nearest to it
    let c = hi;
    for (const e of [...sorted].reverse()) {
      c = Math.min(c - size(e) / 2 - 7, hi - size(e) / 2 - 7);
      while (!free(c, e) && c - size(e) / 2 >= lo) c -= 4;
      if (free(c, e)) {
        placed.set(e, { side, c });
        taken.push([e, { side, c }]);
        c -= size(e) / 2;
      } else overflow.push([side, e]);
    }
  };
  for (const [side, list] of bySide) fit(side, list, true);
  for (const [side, e] of overflow.splice(0)) fit(opposite[side], [e], false);
  // still nowhere to go: the far corner of the original side
  for (const [side, e] of overflow) placed.set(e, { side, c: span(nb, side)[1] - (horizontal(side) ? e.bounds.width : e.bounds.height) / 2 });
  for (const [e, { side, c }] of placed) {
    const w = e.bounds.width;
    const h = e.bounds.height;
    const cx = horizontal(side) ? c : side === 'left' ? nb.x : right(nb);
    const cyv = horizontal(side) ? (side === 'top' ? nb.y : bottom(nb)) : c;
    const dx = Math.round(cx - w / 2) - e.bounds.x;
    const dy = Math.round(cyv - h / 2) - e.bounds.y;
    if (!dx && !dy) continue;
    e.bounds.x += dx;
    e.bounds.y += dy;
    if (e.label) {
      e.label.x += dx;
      e.label.y += dy;
    }
    touched.add(e.id);
  }
}

/** Collapses an expanded sub-process: its content moves to `child` (relative positions kept). */
export function collapse(plane: Plane, sub: DShape, child: Plane, gap: number, touched: Set<string>): void {
  const { shapes, edges } = contentOf(plane, sub.id);
  const old = copyBox(sub.bounds);
  shiftAll(shapes, edges, 160 - (old.x + PAD), 80 - (old.y + 45));
  for (const s of shapes) {
    plane.shapes.delete(s.id);
    if (s.parentId === sub.id) delete s.parentId;
    child.shapes.set(s.id, s);
  }
  for (const e of edges) {
    plane.edges.delete(e.id);
    child.edges.set(e.id, e);
  }
  const size = SIZES.task;
  sub.bounds = { x: old.x, y: Math.round(cy(old) - size.height / 2), width: size.width, height: size.height };
  sub.expanded = false;
  sub.container = false;
  touched.add(sub.id);
  reseatBoundaries(plane, sub, old, touched);
  const band = sub.poolId ? plane.shapes.get(sub.poolId)?.bounds : undefined;
  merge(touched, closeStrip(plane, { axis: 'x', from: right(sub.bounds), to: right(old) + gap, gap, ...(band ? { within: { ...band } } : {}) }));
}

/** Expands a collapsed sub-process: the content of `child` (if any) moves in, room is made. */
export function expand(plane: Plane, sub: DShape, child: Plane | undefined, sem: Semantics, touched: Set<string>): void {
  const content = child ? [...child.shapes.values()] : [];
  let box: Box | undefined;
  for (const s of content) {
    for (const b of [s.bounds, ...(s.label ? [s.label] : [])]) box = box ? union(box, b) : copyBox(b);
  }
  const width = Math.max(350, box ? Math.round(box.width + 2 * PAD) : 0);
  const height = Math.max(200, box ? Math.round(box.height + 45 + PAD) : 0);
  const old = copyBox(sub.bounds);
  // from now on a frame: the space tool grows it right, then down, without growing it over anything else
  // (frame mode, space.ts); its boundary events are re-seated below
  sub.expanded = true;
  sub.container = true;
  const keep = new Set(boundariesOf(plane, sub.id).map((b) => b.id));
  const grow = (axis: 'x' | 'y', delta: number): void => {
    if (delta <= 0) return;
    const line = axis === 'x' ? right(sub.bounds) - 0.5 : bottom(sub.bounds) - 0.5;
    merge(touched, makeSpace(plane, { axis, line, delta, keep, anchors: [sub.id], frame: sub.id }));
  };
  grow('x', width - old.width);
  grow('y', height - old.height);
  sub.bounds = { x: old.x, y: old.y, width, height };
  touched.add(sub.id);
  reseatBoundaries(plane, sub, old, touched);
  if (!child) return;
  const edges = [...child.edges.values()];
  if (box) shiftAll(content, edges, sub.bounds.x + PAD - box.x, sub.bounds.y + 45 - box.y);
  for (const s of content) {
    child.shapes.delete(s.id);
    const scope = sem.scopeOf.get(s.id);
    if (scope && (scope as { id?: string }).id === sub.id) s.parentId = sub.id;
    if (s.poolId === undefined && sub.poolId) s.poolId = sub.poolId;
    plane.shapes.set(s.id, s);
  }
  for (const e of edges) {
    child.edges.delete(e.id);
    plane.edges.set(e.id, e);
  }
  child.deleted = true;
}
