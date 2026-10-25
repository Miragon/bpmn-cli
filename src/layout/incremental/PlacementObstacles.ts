import { bottom, cx, cy, overlaps, right, type Box } from '../../drawing/utils/geom.js';
import { Frames } from '../../drawing/Frames.js';
import { PlaneQuery } from '../../drawing/PlaneQuery.js';

import type { DShape, Plane } from '../../drawing/types.js';
import type { NodePlacer } from './NodePlacer.js';

/** What a new shape in a frame has to keep clear of, and where the space tool may push for it. */
export class PlacementObstacles {
  constructor(private readonly placer: NodePlacer) {}

  /** True when `frame` is `s`'s frame or an ancestor of it. */
  within(plane: Plane, s: DShape, frame: DShape | undefined): boolean {
    return Frames.within(plane, s, frame);
  }

  /**
   * The frame's content plus what is drawn inside it without belonging to it (an annotation in a
   * lane). Groups count, except the ones in `exclude`. `plain` false: no groups, no edge labels.
   */
  of(plane: Plane, frame: DShape | undefined, exclude: ReadonlySet<string>, plain = true): { boxes: Box[]; labels: Box[] } {
    const boxes: Box[] = [];
    const labels: Box[] = [];
    for (const s of plane.shapes.values()) {
      if (exclude.has(s.id) || s === frame) continue;
      if (s.kind === 'group') {
        if (plain) boxes.push(s.bounds);
        continue;
      }
      const solid = PlaneQuery.isLeaf(s) || (s.kind === 'subProcess' && s.container);
      const member = this.within(plane, s, frame);
      const drawnIn = !member && !!frame && solid && overlaps(s.bounds, frame.bounds) && !Frames.within(plane, frame, s);
      if (!member && !drawnIn) {
        if (frame && s.label && overlaps(s.label, frame.bounds)) labels.push(s.label);
        continue;
      }
      if (solid) boxes.push(PlaneQuery.isLeaf(s) && !s.hostId ? this.placer.drawing(plane).unitBox(s) : s.bounds);
      if (s.label) labels.push(s.label);
    }
    if (plain) for (const e of plane.edges.values()) if (e.label) labels.push(e.label);
    return { boxes, labels };
  }

  /** Groups drawn around one of the anchors: a node placed next to it may go inside them. */
  homeGroups(plane: Plane, anchors: ReadonlyArray<DShape | undefined>): string[] {
    const out: string[] = [];
    for (const g of plane.shapes.values()) {
      if (g.kind !== 'group') continue;
      if (anchors.some((a) => !!a && cx(a.bounds) > g.bounds.x && cx(a.bounds) < right(g.bounds) && cy(a.bounds) > g.bounds.y && cy(a.bounds) < bottom(g.bounds))) out.push(g.id);
    }
    return out;
  }

  isFree(box: Box, obs: { boxes: Box[]; labels: Box[] }, clearance = 20): boolean {
    return !obs.boxes.some((b) => overlaps(b, box, clearance)) && !obs.labels.some((l) => overlaps(l, box, 4));
  }

  /**
   * Where a space-tool run for a node goes: inside its expanded sub-process (frame mode: it never
   * grows over foreign shapes), else within its pool.
   */
  spaceBand(plane: Plane, s: Pick<DShape, 'parentId' | 'poolId'>, anchor?: DShape): { within?: Box; frame?: string } {
    const sub = s.parentId ? plane.shapes.get(s.parentId) : undefined;
    if (sub) return { within: { ...sub.bounds }, frame: sub.id };
    const pool = s.poolId ? plane.shapes.get(s.poolId) : undefined;
    if (pool) return { within: { ...pool.bounds } };
    // no pool: a group around the anchor confines the space tool like a pool would
    const group = anchor ? this.homeGroups(plane, [anchor]).map((id) => plane.shapes.get(id)!).sort((a, b) => a.bounds.width * a.bounds.height - b.bounds.width * b.bounds.height)[0] : undefined;
    return group ? { within: { ...group.bounds } } : {};
  }

  /** The centre of `b` lies inside `frame` (the plane: always). */
  private centreIn(b: Box, frame: DShape | undefined): boolean {
    if (!frame) return true;
    const f = frame.bounds;
    return cx(b) > f.x && cx(b) < right(f) && cy(b) > f.y && cy(b) < bottom(f);
  }

  /**
   * Bottom of a frame's own content (members, what is drawn in it, labels of its connections), or
   * undefined when empty. A label or group elsewhere on the plane never counts.
   */
  contentBottom(plane: Plane, frame: DShape | undefined, exclude: ReadonlySet<string>): number | undefined {
    const obs = this.of(plane, frame, exclude, false);
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
  edgeBoxes(plane: Plane): Box[] {
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
}
