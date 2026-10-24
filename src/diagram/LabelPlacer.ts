/**
 * External labels of shapes and connections, placed into a drawing that is
 * kept (the label geometry: utils/labels.ts).
 *
 * CONTRACT
 *  - A label box collides with a shape, another label, a line (the borders
 *    of pools, lanes and expanded sub-processes included) or the title of an
 *    expanded sub-process (utils/plane.ts titleOf; diagram/utils/text.ts titleBox) closer than
 *    2 px (1 px to a line). A label's home is where metrics.ts labelOutsideFrame wants it:
 *    the expanded sub-process its owner lives in, else its pool (a flow's
 *    when both its ends share it).
 *  - placeShapeLabel(shape, prefer?) puts the label of an event,
 *    gateway, boundary event or data object on the first side that collides
 *    with nothing: `prefer` first, then the convention (events / data
 *    below, gateways above, boundary events outside the border they sit on:
 *    below-right of a bottom-border event, above a top-border one, beside a
 *    left / right one), then the other sides and further steps out, then
 *    (all of them taken, e.g. a gateway with a connection on every vertex)
 *    shifted along a side off the line there (labelOnSide), side by side.
 *    Of the centred spots the first one inside the label area of the
 *    shape's frame (utils/plane.ts frameOf; not for a boundary event) wins, else
 *    the first one inside its home (beside a title too; any without a
 *    home); else of the shifted spots of each side in turn the same; else
 *    the first free one anywhere, outside the home. Returns the box (also
 *    stored on the shape); undefined when the element has no name or no
 *    external label.
 *  - placeEdgeLabel(edge) puts a flow label above the first
 *    horizontal segment long enough for it (near its start), else below it,
 *    else beside a vertical segment.
 *  - refitLabel(owner) resizes the label after a rename, keeping the
 *    side it was on; it is re-placed when the new box collides.
 *  - clearTitles(wasClear) places again every named external label
 *    (event, gateway, boundary event, data object / store, sequence or
 *    message flow) that overlaps the title of an expanded sub-process while
 *    wasClear(owner, subProcess) says it was clear of that title before
 *    (the space tool moves a widened sub-process's centred title by half
 *    the added width, a label beyond the line by all of it): a shape's on
 *    the side it was on (placeShapeLabel), a flow's like placeEdgeLabel. A
 *    label whose new spot is on a title too or outside its home stays where
 *    it was. Returns the labels moved, as [owner id, sub-process id].
 *  - labelOnSide(shape, side, size) is the label box on one requested
 *    side that collides with nothing: centred, else shifted along that side
 *    (off a line leaving the shape there), else stepped further out, the
 *    first of them inside the label area of the shape's frame first, then
 *    inside its home; the centred box when every variant collides.
 */
import { labelSize } from './utils/text.js';
import { is } from '../model/utils/moddle.js';
import { bottom, cx, cy, inside, overlaps, right, segmentHits, type Box } from './utils/geom.js';
import { frameOf, raw, titleOf } from './utils/plane.js';
import type { DEdge, DShape, Plane } from './types.js';
import { attachedSide } from './utils/sides.js';
import { hasExternalLabel, labelArea, labelAt, labelSideOf, ORDER, type LabelSide } from './utils/labels.js';

interface Clutter {
  shapes: Box[];
  labels: Box[];
  segments: Array<[{ x: number; y: number }, { x: number; y: number }]>;
}

export class LabelPlacer {
  constructor(private readonly plane: Plane) {}

  private nameOf(el: unknown): string | undefined {
    const n = raw<string>(el, 'name');
    return n && n.trim() ? n : undefined;
  }

  private clutter(ownerId: string, ignoreShapes: ReadonlySet<string>): Clutter {
    const shapes: Box[] = [];
    const labels: Box[] = [];
    const segments: Clutter['segments'] = [];
    for (const s of this.plane.shapes.values()) {
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
    for (const e of this.plane.edges.values()) {
      if (e.label && e.id !== ownerId) labels.push(e.label);
      for (let i = 0; i + 1 < e.points.length; i++) segments.push([e.points[i]!, e.points[i + 1]!]);
    }
    return { shapes, labels, segments };
  }

  private collides(b: Box, c: Clutter): boolean {
    return c.shapes.some((s) => overlaps(s, b, 2)) || c.labels.some((l) => overlaps(l, b, 2)) || c.segments.some(([p, q]) => segmentHits(p, q, b, 1));
  }

  /**
   * The first candidate that collides with nothing: of each list in turn one
   * inside the label area of the shape's frame, then one inside its home
   * (homeOf: beside the title of a sub-process too; any without a home); then
   * any of all lists, outside the home (a boundary event's hangs outside its
   * host).
   */
  private firstFree(s: DShape, c: Clutter, ...lists: Array<readonly Box[]>): Box | undefined {
    const frame = s.kind === 'boundary' ? undefined : frameOf(this.plane, s);
    const home = frame ? this.homeOf(s) : undefined;
    const area = frame ? labelArea(frame) : undefined;
    for (const cands of lists) {
      const free = cands.filter((b) => !this.collides(b, c));
      const win = (area ? free.find((b) => inside(b, area)) : undefined) ?? free.find((b) => !home || inside(b, home.bounds));
      if (win) return win;
    }
    return lists.flat().find((b) => !this.collides(b, c));
  }

  /**
   * The frame a label belongs in (metrics.ts labelOutsideFrame): the expanded
   * sub-process a shape lives in, else its pool; a flow's when both its ends
   * share it; undefined when there is none.
   */
  private homeOf(o: DShape | DEdge): DShape | undefined {
    const of = (s: DShape | undefined): DShape | undefined => (s?.parentId ? this.plane.shapes.get(s.parentId) : undefined) ?? (s?.poolId ? this.plane.shapes.get(s.poolId) : undefined);
    if ('bounds' in o) return of(o);
    const source = of(o.sourceId ? this.plane.shapes.get(o.sourceId) : undefined);
    return source && source === of(o.targetId ? this.plane.shapes.get(o.targetId) : undefined) ? source : undefined;
  }

  /** The label boxes on one side of a shape: centred, then shifted along that side (off a line leaving the shape there), at three steps out. */
  private sideSpots(s: DShape, side: LabelSide, size: { width: number; height: number }, host?: DShape): Box[] {
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
  labelOnSide(s: DShape, side: LabelSide, size: { width: number; height: number }): Box {
    const host = s.hostId ? this.plane.shapes.get(s.hostId) : undefined;
    const c = this.clutter(s.id, new Set([s.id, ...(host ? [host.id] : [])]));
    if (host) c.shapes.push(host.bounds);
    const cands = this.sideSpots(s, side, size, host);
    return this.firstFree(s, c, cands) ?? cands[0]!;
  }

  /**
   * Label boxes of a boundary event outside the border it sits on: below the
   * host for the bottom border (right of the event, left of it, centred under
   * it), above it for the top border, beside it for the left / right border.
   */
  private boundaryLabelCandidates(b: Box, host: Box, size: { width: number; height: number }, step: number): Box[] {
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
  placeShapeLabel(s: DShape, prefer?: LabelSide): Box | undefined {
    const name = this.nameOf(s.el);
    if (!name || !hasExternalLabel(s)) return undefined;
    const { width, height } = labelSize(name);
    const size = { width, height };
    const host = s.hostId ? this.plane.shapes.get(s.hostId) : undefined;
    const ignore = new Set([s.id, ...(host ? [host.id] : [])]);
    const c = this.clutter(s.id, ignore);
    // the host blocks a boundary label too, except where the label hangs below it
    if (host) c.shapes.push(host.bounds);
    const order = ORDER[s.kind] ?? ORDER['event']!;
    const sides = prefer ? [prefer, ...order.filter((x) => x !== prefer)] : order;
    const cands: Box[] = [];
    for (let step = 0; step < 3; step++) {
      if (s.kind === 'boundary' && host && !prefer) {
        cands.push(...this.boundaryLabelCandidates(s.bounds, host.bounds, size, step));
        continue;
      }
      for (const side of sides) cands.push(labelAt(s, size, side, host, step));
    }
    const first = cands[0];
    // then shifted along a side, off a line there, side by side (every side taken in its middle: a gateway with a connection on each vertex); one of
    // them inside the frame before a centred one outside
    const shifted = s.kind !== 'boundary' || prefer ? sides.map((side) => this.sideSpots(s, side, size, host)) : [];
    const free = this.firstFree(s, c, cands, ...shifted);
    s.label = free ?? (prefer ? labelAt(s, size, prefer, host) : first!);
    return s.label;
  }

  /** Places a connection's label (see module contract). */
  placeEdgeLabel(e: DEdge): Box | undefined {
    const name = this.nameOf(e.el);
    if (!name || e.points.length < 2 || !(is(e.el, 'bpmn:SequenceFlow') || is(e.el, 'bpmn:MessageFlow'))) return undefined;
    const { width, height } = labelSize(name);
    const size = { width, height };
    // the edge's own segments count too: bpmn-js text must not sit on its own line either
    const c = this.clutter(e.id, new Set());
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
    e.label = cands.find((b) => !this.collides(b, c)) ?? cands[0]!;
    return e.label;
  }

  /** Places again the labels that came onto the title of an expanded sub-process (see module contract). */
  clearTitles(wasClear: (owner: DShape | DEdge, sub: DShape) => boolean): Array<[string, string]> {
    const titles: Array<[DShape, Box]> = [];
    for (const s of this.plane.shapes.values()) {
      const title = titleOf(s);
      if (title) titles.push([s, title]);
    }
    if (!titles.length) return [];
    const onTitle = (b: Box): DShape | undefined => titles.find(([, t]) => overlaps(b, t))?.[0];
    const out: Array<[string, string]> = [];
    for (const o of [...this.plane.shapes.values(), ...this.plane.edges.values()]) {
      const old = o.label;
      const sub = old && this.nameOf(o.el) ? onTitle(old) : undefined;
      if (!old || !sub || !wasClear(o, sub)) continue;
      if ('bounds' in o) {
        if (!hasExternalLabel(o)) continue;
        const host = o.hostId ? this.plane.shapes.get(o.hostId) : undefined;
        const side = labelSideOf(o, host?.bounds);
        this.placeShapeLabel(o, side === 'inside' ? undefined : side);
      } else this.placeEdgeLabel(o);
      const home = this.homeOf(o);
      if (o.label && !onTitle(o.label) && (!home || inside(o.label, home.bounds))) out.push([o.id, sub.id]);
      else o.label = old;
    }
    return out;
  }

  /** Resizes a label after a rename keeping its side; re-placed when it then collides. */
  refitLabel(owner: DShape | DEdge): Box | undefined {
    const name = this.nameOf(owner.el);
    if (!name) return undefined;
    if ('bounds' in owner) {
      const s = owner as DShape;
      if (!hasExternalLabel(s)) return undefined;
      if (!s.label) return this.placeShapeLabel(s);
      const { width, height } = labelSize(name);
      const size = { width, height };
      const old = s.label;
      const b = s.bounds;
      let box: Box;
      if (old.y >= bottom(b) - 2) box = { x: Math.round(cx(old) - size.width / 2), y: old.y, ...size };
      else if (bottom(old) <= b.y + 2) box = { x: Math.round(cx(old) - size.width / 2), y: Math.round(bottom(old) - size.height), ...size };
      else if (old.x >= right(b) - 2) box = { x: old.x, y: Math.round(cy(old) - size.height / 2), ...size };
      else box = { x: Math.round(right(old) - size.width), y: Math.round(cy(old) - size.height / 2), ...size };
      const host = s.hostId ? this.plane.shapes.get(s.hostId) : undefined;
      const c = this.clutter(s.id, new Set([s.id, ...(host ? [host.id] : [])]));
      if (this.collides(box, c)) return this.placeShapeLabel(s);
      s.label = box;
      return box;
    }
    return this.placeEdgeLabel(owner as DEdge);
  }
}
