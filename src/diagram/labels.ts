/**
 * External labels of shapes and connections, placed into a drawing that is
 * kept.
 *
 * CONTRACT
 *  - labelSizeOf(name) is the engine's estimate of a bpmn-js label (12px
 *    Arial, wrapped at 90 px).
 *  - labelAt(shape, size, side, host?) is the label box on one side of a
 *    shape: below/above centred, left/right vertically centred; a boundary
 *    event's 'below' sits below the host border, right of the event.
 *  - A label box collides with a shape, another label, a line (the borders
 *    of pools, lanes and expanded sub-processes included) or the title of an
 *    expanded sub-process (plane.ts titleOf; text.ts titleBox) closer than
 *    2 px (1 px to a line). labelArea(frame) is where the label of a shape
 *    in that frame goes first: the frame 2 px inside its border, below its
 *    title. A label's home is where metrics.ts labelOutsideFrame wants it:
 *    the expanded sub-process its owner lives in, else its pool (a flow's
 *    when both its ends share it).
 *  - placeShapeLabel(plane, shape, prefer?) puts the label of an event,
 *    gateway, boundary event or data object on the first side that collides
 *    with nothing: `prefer` first, then the convention (events / data
 *    below, gateways above, boundary events outside the border they sit on:
 *    below-right of a bottom-border event, above a top-border one, beside a
 *    left / right one), then the other sides and further steps out, then
 *    (all of them taken, e.g. a gateway with a connection on every vertex)
 *    shifted along a side off the line there (labelOnSide), side by side.
 *    Of the centred spots the first one inside the label area of the
 *    shape's frame (plane.ts frameOf; not for a boundary event) wins, else
 *    the first one inside its home (beside a title too; any without a
 *    home); else of the shifted spots of each side in turn the same; else
 *    the first free one anywhere, outside the home. Returns the box (also
 *    stored on the shape); undefined when the element has no name or no
 *    external label.
 *  - placeEdgeLabel(plane, edge) puts a flow label above the first
 *    horizontal segment long enough for it (near its start), else below it,
 *    else beside a vertical segment.
 *  - refitLabel(plane, owner) resizes the label after a rename, keeping the
 *    side it was on; it is re-placed when the new box collides.
 *  - clearTitles(plane, wasClear) places again every named external label
 *    (event, gateway, boundary event, data object / store, sequence or
 *    message flow) that overlaps the title of an expanded sub-process while
 *    wasClear(owner, subProcess) says it was clear of that title before
 *    (the space tool moves a widened sub-process's centred title by half
 *    the added width, a label beyond the line by all of it): a shape's on
 *    the side it was on (placeShapeLabel), a flow's like placeEdgeLabel. A
 *    label whose new spot is on a title too or outside its home stays where
 *    it was. Returns the labels moved, as [owner id, sub-process id].
 *  - labelSideOf(shape) says on which side of its shape a label sits
 *    ('inside' when it overlaps the shape), edgeLabelSideOf(edge) the side of
 *    the nearest segment; defaultLabelSide(kind) is the convention above
 *    (events / data below, gateways above).
 *  - labelOnSide(plane, shape, side, size) is the label box on one requested
 *    side that collides with nothing: centred, else shifted along that side
 *    (off a line leaving the shape there), else stepped further out, the
 *    first of them inside the label area of the shape's frame first, then
 *    inside its home; the centred box when every variant collides.
 *  - edgeLabelAt(edge, size, side) is the label box of a flow on one side:
 *    above / below the longest horizontal segment, left / right of the
 *    longest vertical one (undefined when the flow has none).
 */
import { labelSize } from '../layout/types.js';
import { is } from '../model.js';
import { bottom, cx, cy, inside, overlaps, right, segmentHits, type Box } from './geom.js';
import { frameOf, raw, titleOf, type DEdge, type DShape, type Plane } from './plane.js';
import { attachedSide } from './router.js';

export type LabelSide = 'above' | 'below' | 'left' | 'right';

export function labelSizeOf(name: string): { width: number; height: number } {
  const { width, height } = labelSize(name);
  return { width, height };
}

/** Shapes drawn with an external label (bpmn-js): events, gateways, data. */
export function hasExternalLabel(s: Pick<DShape, 'kind'>): boolean {
  return s.kind === 'event' || s.kind === 'boundary' || s.kind === 'gateway' || s.kind === 'data';
}

function nameOf(el: unknown): string | undefined {
  const n = raw<string>(el, 'name');
  return n && n.trim() ? n : undefined;
}

/** The label box on one side of a shape. */
export function labelAt(s: DShape, size: { width: number; height: number }, side: LabelSide, host?: DShape, step = 0): Box {
  const b = s.bounds;
  const off = 6 + step * (size.height + 4);
  if (side === 'below' && s.kind === 'boundary' && host) {
    return { x: Math.round(right(b) + 4), y: Math.round(bottom(host.bounds) + 2 + step * (size.height + 4)), ...size };
  }
  switch (side) {
    case 'below':
      return { x: Math.round(cx(b) - size.width / 2), y: Math.round(bottom(b) + off), ...size };
    case 'above':
      return { x: Math.round(cx(b) - size.width / 2), y: Math.round(b.y - size.height - off), ...size };
    case 'right':
      return { x: Math.round(right(b) + 6 + step * 10), y: Math.round(cy(b) - size.height / 2), ...size };
    case 'left':
      return { x: Math.round(b.x - size.width - 6 - step * 10), y: Math.round(cy(b) - size.height / 2), ...size };
  }
}

interface Clutter {
  shapes: Box[];
  labels: Box[];
  segments: Array<[{ x: number; y: number }, { x: number; y: number }]>;
}

function clutter(plane: Plane, ownerId: string, ignoreShapes: ReadonlySet<string>): Clutter {
  const shapes: Box[] = [];
  const labels: Box[] = [];
  const segments: Clutter['segments'] = [];
  for (const s of plane.shapes.values()) {
    if (!s.container && s.kind !== 'group' && !ignoreShapes.has(s.id)) shapes.push(s.bounds);
    if (s.label && s.id !== ownerId) labels.push(s.label);
    // nor on the title of an expanded sub-process
    const title = titleOf(s);
    if (title) shapes.push(title);
    if (s.container) {
      // a label should not sit on the border of a pool, lane or sub-process
      const b = s.bounds;
      const tl = { x: b.x, y: b.y };
      const tr = { x: right(b), y: b.y };
      const br = { x: right(b), y: bottom(b) };
      const bl = { x: b.x, y: bottom(b) };
      segments.push([tl, tr], [tr, br], [br, bl], [bl, tl]);
    }
  }
  for (const e of plane.edges.values()) {
    if (e.label && e.id !== ownerId) labels.push(e.label);
    for (let i = 0; i + 1 < e.points.length; i++) segments.push([e.points[i]!, e.points[i + 1]!]);
  }
  return { shapes, labels, segments };
}

function collides(b: Box, c: Clutter): boolean {
  return c.shapes.some((s) => overlaps(s, b, 2)) || c.labels.some((l) => overlaps(l, b, 2)) || c.segments.some(([p, q]) => segmentHits(p, q, b, 1));
}

/**
 * Where a label of a shape inside `frame` goes first: the frame 2 px inside
 * its border, below the title of an expanded sub-process.
 */
export function labelArea(frame: DShape): Box {
  const b = frame.bounds;
  const title = titleOf(frame);
  const top = title ? bottom(title) + 2 : b.y + 2;
  return { x: b.x + 2, y: top, width: Math.max(0, b.width - 4), height: Math.max(0, bottom(b) - 2 - top) };
}

/**
 * The first candidate that collides with nothing: of each list in turn one
 * inside the label area of the shape's frame, then one inside its home
 * (homeOf: beside the title of a sub-process too; any without a home); then
 * any of all lists, outside the home (a boundary event's hangs outside its
 * host).
 */
function firstFree(plane: Plane, s: DShape, c: Clutter, ...lists: Array<readonly Box[]>): Box | undefined {
  const frame = s.kind === 'boundary' ? undefined : frameOf(plane, s);
  const home = frame ? homeOf(plane, s) : undefined;
  const area = frame ? labelArea(frame) : undefined;
  for (const cands of lists) {
    const free = cands.filter((b) => !collides(b, c));
    const win = (area ? free.find((b) => inside(b, area)) : undefined) ?? free.find((b) => !home || inside(b, home.bounds));
    if (win) return win;
  }
  return lists.flat().find((b) => !collides(b, c));
}

/**
 * The frame a label belongs in (metrics.ts labelOutsideFrame): the expanded
 * sub-process a shape lives in, else its pool; a flow's when both its ends
 * share it; undefined when there is none.
 */
function homeOf(plane: Plane, o: DShape | DEdge): DShape | undefined {
  const of = (s: DShape | undefined): DShape | undefined => (s?.parentId ? plane.shapes.get(s.parentId) : undefined) ?? (s?.poolId ? plane.shapes.get(s.poolId) : undefined);
  if ('bounds' in o) return of(o);
  const source = of(o.sourceId ? plane.shapes.get(o.sourceId) : undefined);
  return source && source === of(o.targetId ? plane.shapes.get(o.targetId) : undefined) ? source : undefined;
}

const ORDER: Record<string, LabelSide[]> = {
  event: ['below', 'above', 'right', 'left'],
  boundary: ['below', 'right', 'left', 'above'],
  gateway: ['above', 'below', 'right', 'left'],
  data: ['below', 'right', 'left', 'above'],
};

/** The convention for a shape kind's external label (the first side placeShapeLabel tries). */
export function defaultLabelSide(kind: DShape['kind']): LabelSide {
  return ORDER[kind]?.[0] ?? 'below';
}

/** Side of its shape a label sits on (see module contract). */
export function labelSideOf(s: Pick<DShape, 'bounds' | 'label' | 'kind' | 'hostId'>, host?: Box): LabelSide | 'inside' | undefined {
  const l = s.label;
  if (!l) return undefined;
  const b = s.bounds;
  // a boundary event's label hangs below its host border
  if (host && s.kind === 'boundary' && l.y >= bottom(host) - 2) return 'below';
  if (l.y >= bottom(b) - 2) return 'below';
  if (bottom(l) <= b.y + 2) return 'above';
  if (l.x >= right(b) - 2) return 'right';
  if (right(l) <= b.x + 2) return 'left';
  return 'inside';
}

/** Side of the nearest segment a flow label sits on. */
export function edgeLabelSideOf(e: Pick<DEdge, 'points' | 'label'>): LabelSide | undefined {
  const l = e.label;
  if (!l || e.points.length < 2) return undefined;
  const c = { x: cx(l), y: cy(l) };
  let best: LabelSide | undefined;
  let bestD = Infinity;
  for (let i = 0; i + 1 < e.points.length; i++) {
    const p = e.points[i]!;
    const q = e.points[i + 1]!;
    const horizontal = Math.abs(p.y - q.y) <= Math.abs(p.x - q.x);
    const lo = horizontal ? Math.min(p.x, q.x) : Math.min(p.y, q.y);
    const hi = horizontal ? Math.max(p.x, q.x) : Math.max(p.y, q.y);
    const along = horizontal ? c.x : c.y;
    const off = Math.max(0, lo - along, along - hi);
    const across = horizontal ? c.y - p.y : c.x - p.x;
    const d = Math.hypot(off, across);
    if (d < bestD) {
      bestD = d;
      best = horizontal ? (across < 0 ? 'above' : 'below') : across < 0 ? 'left' : 'right';
    }
  }
  return best;
}

/** The label box of a flow on one side (see module contract). */
export function edgeLabelAt(e: Pick<DEdge, 'points'>, size: { width: number; height: number }, side: LabelSide): Box | undefined {
  const horizontal = side === 'above' || side === 'below';
  let best: [{ x: number; y: number }, { x: number; y: number }] | undefined;
  let len = 0;
  for (let i = 0; i + 1 < e.points.length; i++) {
    const p = e.points[i]!;
    const q = e.points[i + 1]!;
    const l = horizontal ? (Math.abs(p.y - q.y) < 0.5 ? Math.abs(p.x - q.x) : 0) : Math.abs(p.x - q.x) < 0.5 ? Math.abs(p.y - q.y) : 0;
    if (l > len) {
      len = l;
      best = [p, q];
    }
  }
  if (!best) return undefined;
  const [p, q] = best;
  if (horizontal) {
    const x = Math.round((p.x + q.x) / 2 - size.width / 2);
    return { x, y: Math.round(side === 'above' ? p.y - size.height - 4 : p.y + 4), ...size };
  }
  const y = Math.round((p.y + q.y) / 2 - size.height / 2);
  return { x: Math.round(side === 'left' ? p.x - size.width - 6 : p.x + 6), y, ...size };
}

/** The label boxes on one side of a shape: centred, then shifted along that side (off a line leaving the shape there), at three steps out. */
function sideSpots(s: DShape, side: LabelSide, size: { width: number; height: number }, host?: DShape): Box[] {
  const cands: Box[] = [];
  for (let step = 0; step < 3; step++) {
    const base = labelAt(s, size, side, host, step);
    cands.push(base);
    if (side === 'below' || side === 'above') cands.push({ ...base, x: Math.round(cx(s.bounds) + 6) }, { ...base, x: Math.round(cx(s.bounds) - 6 - size.width) });
    else cands.push({ ...base, y: Math.round(cy(s.bounds) + 6) }, { ...base, y: Math.round(cy(s.bounds) - 6 - size.height) });
  }
  return cands;
}

/** A label box on one requested side that collides with nothing, if possible (see module contract). */
export function labelOnSide(plane: Plane, s: DShape, side: LabelSide, size: { width: number; height: number }): Box {
  const host = s.hostId ? plane.shapes.get(s.hostId) : undefined;
  const c = clutter(plane, s.id, new Set([s.id, ...(host ? [host.id] : [])]));
  if (host) c.shapes.push(host.bounds);
  const cands = sideSpots(s, side, size, host);
  return firstFree(plane, s, c, cands) ?? cands[0]!;
}

/**
 * Label boxes of a boundary event outside the border it sits on: below the
 * host for the bottom border (right of the event, left of it, centred under
 * it), above it for the top border, beside it for the left / right border.
 */
function boundaryLabelCandidates(b: Box, host: Box, size: { width: number; height: number }, step: number): Box[] {
  const box = (x: number, y: number): Box => ({ x: Math.round(x), y: Math.round(y), ...size });
  switch (attachedSide(b, host)) {
    case 'top': {
      const y = host.y - 2 - size.height - step * (size.height + 4);
      return [box(right(b) + 4, y), box(b.x - 4 - size.width, y), box(cx(b) - size.width / 2, Math.min(y, b.y - 4 - size.height))];
    }
    case 'right': {
      const x = right(host) + 2 + step * 10;
      return [box(Math.max(x, right(b) + 4), bottom(b) + 4 + step * (size.height + 4)), box(Math.max(x, right(b) + 4), b.y - 4 - size.height - step * (size.height + 4)), box(Math.max(x, right(b) + 4), cy(b) - size.height / 2)];
    }
    case 'left': {
      const x = host.x - 2 - size.width - step * 10;
      return [box(Math.min(x, b.x - 4 - size.width), bottom(b) + 4 + step * (size.height + 4)), box(Math.min(x, b.x - 4 - size.width), b.y - 4 - size.height - step * (size.height + 4)), box(Math.min(x, b.x - 4 - size.width), cy(b) - size.height / 2)];
    }
    default: {
      // hanging below the host
      const y = bottom(host) + 2 + step * (size.height + 4);
      return [box(right(b) + 4, y), box(b.x - 4 - size.width, y), box(cx(b) - size.width / 2, Math.max(y, bottom(b) + 4))];
    }
  }
}

/** Places a shape's external label (see module contract). */
export function placeShapeLabel(plane: Plane, s: DShape, prefer?: LabelSide): Box | undefined {
  const name = nameOf(s.el);
  if (!name || !hasExternalLabel(s)) return undefined;
  const size = labelSizeOf(name);
  const host = s.hostId ? plane.shapes.get(s.hostId) : undefined;
  const ignore = new Set([s.id, ...(host ? [host.id] : [])]);
  const c = clutter(plane, s.id, ignore);
  // the host blocks a boundary label too, except where the label hangs below it
  if (host) c.shapes.push(host.bounds);
  const order = ORDER[s.kind] ?? ORDER['event']!;
  const sides = prefer ? [prefer, ...order.filter((x) => x !== prefer)] : order;
  const cands: Box[] = [];
  for (let step = 0; step < 3; step++) {
    if (s.kind === 'boundary' && host && !prefer) {
      cands.push(...boundaryLabelCandidates(s.bounds, host.bounds, size, step));
      continue;
    }
    for (const side of sides) cands.push(labelAt(s, size, side, host, step));
  }
  const first = cands[0];
  // then shifted along a side, off a line there, side by side (every side taken in its middle: a gateway with a connection on each vertex); one of
  // them inside the frame before a centred one outside
  const shifted = s.kind !== 'boundary' || prefer ? sides.map((side) => sideSpots(s, side, size, host)) : [];
  const free = firstFree(plane, s, c, cands, ...shifted);
  s.label = free ?? (prefer ? labelAt(s, size, prefer, host) : first!);
  return s.label;
}

/** Places a connection's label (see module contract). */
export function placeEdgeLabel(plane: Plane, e: DEdge): Box | undefined {
  const name = nameOf(e.el);
  if (!name || e.points.length < 2 || !(is(e.el, 'bpmn:SequenceFlow') || is(e.el, 'bpmn:MessageFlow'))) return undefined;
  const size = labelSizeOf(name);
  // the edge's own segments count too: bpmn-js text must not sit on its own line either
  const c = clutter(plane, e.id, new Set());
  const cands: Box[] = [];
  const pts = e.points;
  for (let i = 0; i + 1 < pts.length; i++) {
    const p = pts[i]!;
    const q = pts[i + 1]!;
    if (Math.abs(p.y - q.y) < 0.5) {
      const lo = Math.min(p.x, q.x);
      const hi = Math.max(p.x, q.x);
      if (hi - lo < size.width / 2) continue;
      // near the start first (BPMN convention), then the middle and the end of the segment
      const xs = [Math.min(lo + 8, Math.max(lo + 2, hi - size.width - 4)), (lo + hi) / 2 - size.width / 2, hi - size.width - 8];
      for (const x of xs) cands.push({ x: Math.round(x), y: Math.round(p.y - size.height - 4), ...size }, { x: Math.round(x), y: Math.round(p.y + 4), ...size });
    }
  }
  for (let i = 0; i + 1 < pts.length; i++) {
    const p = pts[i]!;
    const q = pts[i + 1]!;
    if (Math.abs(p.x - q.x) < 0.5 && Math.abs(p.y - q.y) >= size.height) {
      const y = Math.round(Math.min(p.y, q.y) + Math.abs(p.y - q.y) / 2 - size.height / 2);
      cands.push({ x: Math.round(p.x + 6), y, ...size }, { x: Math.round(p.x - size.width - 6), y, ...size });
    }
  }
  if (!cands.length) {
    const p = pts[0]!;
    cands.push({ x: Math.round(p.x + 6), y: Math.round(p.y - size.height - 4), ...size });
  }
  e.label = cands.find((b) => !collides(b, c)) ?? cands[0]!;
  return e.label;
}

/** Places again the labels that came onto the title of an expanded sub-process (see module contract). */
export function clearTitles(plane: Plane, wasClear: (owner: DShape | DEdge, sub: DShape) => boolean): Array<[string, string]> {
  const titles: Array<[DShape, Box]> = [];
  for (const s of plane.shapes.values()) {
    const title = titleOf(s);
    if (title) titles.push([s, title]);
  }
  if (!titles.length) return [];
  const onTitle = (b: Box): DShape | undefined => titles.find(([, t]) => overlaps(b, t))?.[0];
  const out: Array<[string, string]> = [];
  for (const o of [...plane.shapes.values(), ...plane.edges.values()]) {
    const old = o.label;
    const sub = old && nameOf(o.el) ? onTitle(old) : undefined;
    if (!old || !sub || !wasClear(o, sub)) continue;
    if ('bounds' in o) {
      if (!hasExternalLabel(o)) continue;
      const host = o.hostId ? plane.shapes.get(o.hostId) : undefined;
      const side = labelSideOf(o, host?.bounds);
      placeShapeLabel(plane, o, side === 'inside' ? undefined : side);
    } else placeEdgeLabel(plane, o);
    const home = homeOf(plane, o);
    if (o.label && !onTitle(o.label) && (!home || inside(o.label, home.bounds))) out.push([o.id, sub.id]);
    else o.label = old;
  }
  return out;
}

/** Resizes a label after a rename keeping its side; re-placed when it then collides. */
export function refitLabel(plane: Plane, owner: DShape | DEdge): Box | undefined {
  const name = nameOf(owner.el);
  if (!name) return undefined;
  if ('bounds' in owner) {
    const s = owner as DShape;
    if (!hasExternalLabel(s)) return undefined;
    if (!s.label) return placeShapeLabel(plane, s);
    const size = labelSizeOf(name);
    const old = s.label;
    const b = s.bounds;
    let box: Box;
    if (old.y >= bottom(b) - 2) box = { x: Math.round(cx(old) - size.width / 2), y: old.y, ...size };
    else if (bottom(old) <= b.y + 2) box = { x: Math.round(cx(old) - size.width / 2), y: Math.round(bottom(old) - size.height), ...size };
    else if (old.x >= right(b) - 2) box = { x: old.x, y: Math.round(cy(old) - size.height / 2), ...size };
    else box = { x: Math.round(right(old) - size.width), y: Math.round(cy(old) - size.height / 2), ...size };
    const host = s.hostId ? plane.shapes.get(s.hostId) : undefined;
    const c = clutter(plane, s.id, new Set([s.id, ...(host ? [host.id] : [])]));
    if (collides(box, c)) return placeShapeLabel(plane, s);
    s.label = box;
    return box;
  }
  return placeEdgeLabel(plane, owner as DEdge);
}
