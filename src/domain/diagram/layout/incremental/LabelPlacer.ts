import { labelSize } from '../../utils/text.js';
import { is } from '../../../document/utils/moddle.js';
import { bottom, cx, cy, inside, overlaps, right, segmentHits, type Box } from '../../utils/geom.js';
import { Frames } from '../../di/Frames.js';
import { raw } from '../../utils/raw.js';
import type { DEdge, DShape, Plane } from '../../di/types.js';
import { attachedSide } from '../../utils/sides.js';
import { hasExternalLabel, labelAt, labelSideOf, ORDER, type LabelSide } from '../../utils/labels.js';

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
    const name = raw<string>(el, 'name');
    return name && name.trim() ? name : undefined;
  }

  private clutter(ownerId: string, ignoreShapes: ReadonlySet<string>): Clutter {
    const shapes: Box[] = [];
    const labels: Box[] = [];
    const segments: Clutter['segments'] = [];
    for (const shape of this.plane.shapes.values()) {
      if (!shape.container && shape.kind !== 'group' && !ignoreShapes.has(shape.id)) shapes.push(shape.bounds);
      if (shape.label && shape.id !== ownerId) labels.push(shape.label);
      const title = Frames.title(shape);
      if (title) shapes.push(title);
      if (shape.container) {
        const bounds = shape.bounds;
        const tl = { x: bounds.x, y: bounds.y };
        const tr = { x: right(bounds), y: bounds.y };
        const br = { x: right(bounds), y: bottom(bounds) };
        const bl = { x: bounds.x, y: bottom(bounds) };
        segments.push([tl, tr], [tr, br], [br, bl], [bl, tl]);
      }
    }
    for (const edge of this.plane.edges.values()) {
      if (edge.label && edge.id !== ownerId) labels.push(edge.label);
      for (let index = 0; index + 1 < edge.points.length; index++) segments.push([edge.points[index]!, edge.points[index + 1]!]);
    }
    return { shapes, labels, segments };
  }

  private collides(candidate: Box, clutter: Clutter): boolean {
    return clutter.shapes.some((shape) => overlaps(shape, candidate, 2)) || clutter.labels.some((label) => overlaps(label, candidate, 2)) || clutter.segments.some(([start, end]) => segmentHits(start, end, candidate, 1));
  }

  /**
   * Per list: a free spot in the frame's label area, else in the home frame;
   * only then any free spot of all lists (a boundary event's label hangs outside its host).
   */
  private firstFree(shape: DShape, clutter: Clutter, ...lists: Array<readonly Box[]>): Box | undefined {
    const frame = shape.kind === 'boundary' ? undefined : Frames.of(this.plane, shape);
    const home = frame ? this.homeOf(shape) : undefined;
    const area = frame ? Frames.labelArea(frame) : undefined;
    for (const cands of lists) {
      const free = cands.filter((candidate) => !this.collides(candidate, clutter));
      const win = (area ? free.find((candidate) => inside(candidate, area)) : undefined) ?? free.find((candidate) => !home || inside(candidate, home.bounds));
      if (win) return win;
    }
    return lists.flat().find((candidate) => !this.collides(candidate, clutter));
  }

  /** The sub-process a shape lives in, else its pool; a flow's only when both ends share it. */
  private homeOf(owner: DShape | DEdge): DShape | undefined {
    const of = (shape: DShape | undefined): DShape | undefined => (shape?.parentId ? this.plane.shapes.get(shape.parentId) : undefined) ?? (shape?.poolId ? this.plane.shapes.get(shape.poolId) : undefined);
    if ('bounds' in owner) return of(owner);
    const source = of(owner.sourceId ? this.plane.shapes.get(owner.sourceId) : undefined);
    return source && source === of(owner.targetId ? this.plane.shapes.get(owner.targetId) : undefined) ? source : undefined;
  }

  /** Centred, then shifted off a line leaving the shape on that side, at three steps out. */
  private sideSpots(shape: DShape, side: LabelSide, size: { width: number; height: number }, host?: DShape): Box[] {
    const cands: Box[] = [];
    for (let step = 0; step < 3; step++) {
      const base = labelAt(shape, size, side, host, step);
      cands.push(base);
      if (side === 'below' || side === 'above') cands.push({ ...base, x: Math.round(cx(shape.bounds) + 6) }, { ...base, x: Math.round(cx(shape.bounds) - 6 - size.width) });
      else cands.push({ ...base, y: Math.round(cy(shape.bounds) + 6) }, { ...base, y: Math.round(cy(shape.bounds) - 6 - size.height) });
    }
    return cands;
  }

  labelOnSide(shape: DShape, side: LabelSide, size: { width: number; height: number }): Box {
    const host = shape.hostId ? this.plane.shapes.get(shape.hostId) : undefined;
    const clutter = this.clutter(shape.id, new Set([shape.id, ...(host ? [host.id] : [])]));
    if (host) clutter.shapes.push(host.bounds);
    const cands = this.sideSpots(shape, side, size, host);
    return this.firstFree(shape, clutter, cands) ?? cands[0]!;
  }

  /**
   * Spots for a boundary event's label by the border it sits on; on the bottom border it hangs
   * below the host.
   */
  private boundaryLabelCandidates(boundary: Box, host: Box, size: { width: number; height: number }, step: number): Box[] {
    const box = (left: number, top: number): Box => ({ x: Math.round(left), y: Math.round(top), ...size });
    switch (attachedSide(boundary, host)) {
      case 'top': {
        const top = host.y - 2 - size.height - step * (size.height + 4);
        return [box(right(boundary) + 4, top), box(boundary.x - 4 - size.width, top), box(cx(boundary) - size.width / 2, Math.min(top, boundary.y - 4 - size.height))];
      }
      case 'right': {
        const left = right(host) + 2 + step * 10;
        return [box(Math.max(left, right(boundary) + 4), bottom(boundary) + 4 + step * (size.height + 4)), box(Math.max(left, right(boundary) + 4), boundary.y - 4 - size.height - step * (size.height + 4)), box(Math.max(left, right(boundary) + 4), cy(boundary) - size.height / 2)];
      }
      case 'left': {
        const left = host.x - 2 - size.width - step * 10;
        return [box(Math.min(left, boundary.x - 4 - size.width), bottom(boundary) + 4 + step * (size.height + 4)), box(Math.min(left, boundary.x - 4 - size.width), boundary.y - 4 - size.height - step * (size.height + 4)), box(Math.min(left, boundary.x - 4 - size.width), cy(boundary) - size.height / 2)];
      }
      default: {
        const top = bottom(host) + 2 + step * (size.height + 4);
        return [box(right(boundary) + 4, top), box(boundary.x - 4 - size.width, top), box(cx(boundary) - size.width / 2, Math.max(top, bottom(boundary) + 4))];
      }
    }
  }

  /**
   * `prefer` first, then the kind's conventional sides, then further out and shifted spots.
   * The host blocks a boundary label too, except where the label hangs below it.
   */
  placeShapeLabel(shape: DShape, prefer?: LabelSide): Box | undefined {
    const name = this.nameOf(shape.el);
    if (!name || !hasExternalLabel(shape)) return undefined;
    const { width, height } = labelSize(name);
    const size = { width, height };
    const host = shape.hostId ? this.plane.shapes.get(shape.hostId) : undefined;
    const ignore = new Set([shape.id, ...(host ? [host.id] : [])]);
    const clutter = this.clutter(shape.id, ignore);
    if (host) clutter.shapes.push(host.bounds);
    const order = ORDER[shape.kind] ?? ORDER['event']!;
    const sides = prefer ? [prefer, ...order.filter((side) => side !== prefer)] : order;
    const cands: Box[] = [];
    for (let step = 0; step < 3; step++) {
      if (shape.kind === 'boundary' && host && !prefer) {
        cands.push(...this.boundaryLabelCandidates(shape.bounds, host.bounds, size, step));
        continue;
      }
      for (const side of sides) cands.push(labelAt(shape, size, side, host, step));
    }
    const first = cands[0];
    /**
     * shifted spots help when every side is taken in its middle (a gateway with a flow on
     * each vertex); a shifted one inside the frame beats a centred one outside
     */
    const shifted = shape.kind !== 'boundary' || prefer ? sides.map((side) => this.sideSpots(shape, side, size, host)) : [];
    const free = this.firstFree(shape, clutter, cands, ...shifted);
    shape.label = free ?? (prefer ? labelAt(shape, size, prefer, host) : first!);
    return shape.label;
  }

  /**
   * Above or below the first long enough horizontal segment, else beside a vertical one.
   * On a segment near the start first (BPMN convention), then the middle and the end. The edge's
   * own segments count as clutter: bpmn-js text must not sit on its own line either.
   */
  placeEdgeLabel(edge: DEdge): Box | undefined {
    const name = this.nameOf(edge.el);
    if (!name || edge.points.length < 2 || !(is(edge.el, 'bpmn:SequenceFlow') || is(edge.el, 'bpmn:MessageFlow'))) return undefined;
    const { width, height } = labelSize(name);
    const size = { width, height };
    const clutter = this.clutter(edge.id, new Set());
    const cands: Box[] = [];
    const pts = edge.points;
    for (let index = 0; index + 1 < pts.length; index++) {
      const start = pts[index]!;
      const end = pts[index + 1]!;
      if (Math.abs(start.y - end.y) < 0.5) {
        const lo = Math.min(start.x, end.x);
        const hi = Math.max(start.x, end.x);
        if (hi - lo < size.width / 2) continue;
        const xs = [Math.min(lo + 8, Math.max(lo + 2, hi - size.width - 4)), (lo + hi) / 2 - size.width / 2, hi - size.width - 8];
        for (const left of xs) cands.push({ x: Math.round(left), y: Math.round(start.y - size.height - 4), ...size }, { x: Math.round(left), y: Math.round(start.y + 4), ...size });
      }
    }
    for (let index = 0; index + 1 < pts.length; index++) {
      const start = pts[index]!;
      const end = pts[index + 1]!;
      if (Math.abs(start.x - end.x) < 0.5 && Math.abs(start.y - end.y) >= size.height) {
        const top = Math.round(Math.min(start.y, end.y) + Math.abs(start.y - end.y) / 2 - size.height / 2);
        cands.push({ x: Math.round(start.x + 6), y: top, ...size }, { x: Math.round(start.x - size.width - 6), y: top, ...size });
      }
    }
    if (!cands.length) {
      const start = pts[0]!;
      cands.push({ x: Math.round(start.x + 6), y: Math.round(start.y - size.height - 4), ...size });
    }
    edge.label = cands.find((candidate) => !this.collides(candidate, clutter)) ?? cands[0]!;
    return edge.label;
  }

  /**
   * Re-places labels a widened sub-process's moved title now covers, if `wasClear` says they were
   * clear before; a new spot on a title or outside the home is rejected. Returns [owner, sub].
   */
  clearTitles(wasClear: (owner: DShape | DEdge, sub: DShape) => boolean): Array<[string, string]> {
    const titles: Array<[DShape, Box]> = [];
    for (const shape of this.plane.shapes.values()) {
      const title = Frames.title(shape);
      if (title) titles.push([shape, title]);
    }
    if (!titles.length) return [];
    const onTitle = (box: Box): DShape | undefined => titles.find(([, title]) => overlaps(box, title))?.[0];
    const out: Array<[string, string]> = [];
    for (const owner of [...this.plane.shapes.values(), ...this.plane.edges.values()]) {
      const old = owner.label;
      const sub = old && this.nameOf(owner.el) ? onTitle(old) : undefined;
      if (!old || !sub || !wasClear(owner, sub)) continue;
      if ('bounds' in owner) {
        if (!hasExternalLabel(owner)) continue;
        const host = owner.hostId ? this.plane.shapes.get(owner.hostId) : undefined;
        const side = labelSideOf(owner, host?.bounds);
        this.placeShapeLabel(owner, side === 'inside' ? undefined : side);
      } else this.placeEdgeLabel(owner);
      const home = this.homeOf(owner);
      if (owner.label && !onTitle(owner.label) && (!home || inside(owner.label, home.bounds))) out.push([owner.id, sub.id]);
      else owner.label = old;
    }
    return out;
  }

  /** Resizes a label after a rename keeping its side; re-placed when it then collides. */
  refitLabel(owner: DShape | DEdge): Box | undefined {
    const name = this.nameOf(owner.el);
    if (!name) return undefined;
    if ('bounds' in owner) {
      const shape = owner as DShape;
      if (!hasExternalLabel(shape)) return undefined;
      if (!shape.label) return this.placeShapeLabel(shape);
      const { width, height } = labelSize(name);
      const size = { width, height };
      const old = shape.label;
      const bounds = shape.bounds;
      let box: Box;
      if (old.y >= bottom(bounds) - 2) box = { x: Math.round(cx(old) - size.width / 2), y: old.y, ...size };
      else if (bottom(old) <= bounds.y + 2) box = { x: Math.round(cx(old) - size.width / 2), y: Math.round(bottom(old) - size.height), ...size };
      else if (old.x >= right(bounds) - 2) box = { x: old.x, y: Math.round(cy(old) - size.height / 2), ...size };
      else box = { x: Math.round(right(old) - size.width), y: Math.round(cy(old) - size.height / 2), ...size };
      const host = shape.hostId ? this.plane.shapes.get(shape.hostId) : undefined;
      const clutter = this.clutter(shape.id, new Set([shape.id, ...(host ? [host.id] : [])]));
      if (this.collides(box, clutter)) return this.placeShapeLabel(shape);
      shape.label = box;
      return box;
    }
    return this.placeEdgeLabel(owner as DEdge);
  }
}
