import { labelSize } from '../../drawing/utils/text.js';
import { is } from '../../model/utils/moddle.js';
import { bottom, cx, cy, inside, overlaps, right, segmentHits, type Box } from '../../drawing/utils/geom.js';
import { Frames } from '../../drawing/Frames.js';
import { raw } from '../../drawing/utils/raw.js';
import type { DEdge, DShape, Plane } from '../../drawing/types.js';
import { attachedSide } from '../../drawing/utils/sides.js';
import { hasExternalLabel, labelAt, labelSideOf, ORDER, type LabelSide } from '../../drawing/utils/labels.js';

interface Clutter {
  shapes: Box[];
  labels: Box[];
  segments: Array<[{ x: number; y: number }, { x: number; y: number }]>;
}

/**
 * Places the external labels of shapes and connections into a kept drawing.
 * A label must keep 2 px off shapes, labels and sub-process titles and 1 px off lines and frame
 * borders, and should stay inside its home frame (the one checkLabelFrames expects).
 */
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
      const title = Frames.title(s);
      if (title) shapes.push(title);
      if (s.container) {
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
   * Per list: a free spot in the frame's label area, else in the home frame;
   * only then any free spot of all lists (a boundary event's label hangs outside its host).
   */
  private firstFree(s: DShape, c: Clutter, ...lists: Array<readonly Box[]>): Box | undefined {
    const frame = s.kind === 'boundary' ? undefined : Frames.of(this.plane, s);
    const home = frame ? this.homeOf(s) : undefined;
    const area = frame ? Frames.labelArea(frame) : undefined;
    for (const cands of lists) {
      const free = cands.filter((b) => !this.collides(b, c));
      const win = (area ? free.find((b) => inside(b, area)) : undefined) ?? free.find((b) => !home || inside(b, home.bounds));
      if (win) return win;
    }
    return lists.flat().find((b) => !this.collides(b, c));
  }

  /** The sub-process a shape lives in, else its pool; a flow's only when both ends share it. */
  private homeOf(o: DShape | DEdge): DShape | undefined {
    const of = (s: DShape | undefined): DShape | undefined => (s?.parentId ? this.plane.shapes.get(s.parentId) : undefined) ?? (s?.poolId ? this.plane.shapes.get(s.poolId) : undefined);
    if ('bounds' in o) return of(o);
    const source = of(o.sourceId ? this.plane.shapes.get(o.sourceId) : undefined);
    return source && source === of(o.targetId ? this.plane.shapes.get(o.targetId) : undefined) ? source : undefined;
  }

  /** Centred, then shifted off a line leaving the shape on that side, at three steps out. */
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

  labelOnSide(s: DShape, side: LabelSide, size: { width: number; height: number }): Box {
    const host = s.hostId ? this.plane.shapes.get(s.hostId) : undefined;
    const c = this.clutter(s.id, new Set([s.id, ...(host ? [host.id] : [])]));
    if (host) c.shapes.push(host.bounds);
    const cands = this.sideSpots(s, side, size, host);
    return this.firstFree(s, c, cands) ?? cands[0]!;
  }

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

  /** `prefer` first, then the kind's conventional sides, then further out and shifted spots. */
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
    /**
     * shifted spots help when every side is taken in its middle (a gateway with a flow on
     * each vertex); a shifted one inside the frame beats a centred one outside
     */
    const shifted = s.kind !== 'boundary' || prefer ? sides.map((side) => this.sideSpots(s, side, size, host)) : [];
    const free = this.firstFree(s, c, cands, ...shifted);
    s.label = free ?? (prefer ? labelAt(s, size, prefer, host) : first!);
    return s.label;
  }

  /** Above or below the first long enough horizontal segment, else beside a vertical one. */
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

  /**
   * Re-places labels a widened sub-process's moved title now covers, if `wasClear` says they were
   * clear before; a new spot on a title or outside the home is rejected. Returns [owner, sub].
   */
  clearTitles(wasClear: (owner: DShape | DEdge, sub: DShape) => boolean): Array<[string, string]> {
    const titles: Array<[DShape, Box]> = [];
    for (const s of this.plane.shapes.values()) {
      const title = Frames.title(s);
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
