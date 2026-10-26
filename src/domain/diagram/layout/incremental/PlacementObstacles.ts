import { bottom, cx, cy, overlaps, right, type Box } from '../../utils/geom.js';
import { Frames } from '../../di/Frames.js';
import { PlaneQuery } from '../../di/PlaneQuery.js';

import type { DShape, Plane } from '../../di/types.js';
import type { NodePlacer } from './NodePlacer.js';

/** What a new shape in a frame has to keep clear of, and where the space tool may push for it. */
export class PlacementObstacles {
  constructor(private readonly placer: NodePlacer) {}

  /** True when `frame` is `s`'s frame or an ancestor of it. */
  within(plane: Plane, shape: DShape, frame: DShape | undefined): boolean {
    return Frames.within(plane, shape, frame);
  }

  /**
   * The frame's content plus what is drawn inside it without belonging to it (an annotation in a
   * lane). Groups count, except the ones in `exclude`. `plain` false: no groups, no edge labels.
   */
  of(plane: Plane, frame: DShape | undefined, exclude: ReadonlySet<string>, plain = true): { boxes: Box[]; labels: Box[] } {
    const boxes: Box[] = [];
    const labels: Box[] = [];
    for (const shape of plane.shapes.values()) {
      if (exclude.has(shape.id) || shape === frame) continue;
      if (shape.kind === 'group') {
        if (plain) boxes.push(shape.bounds);
        continue;
      }
      const solid = PlaneQuery.isLeaf(shape) || (shape.kind === 'subProcess' && shape.container);
      const member = this.within(plane, shape, frame);
      const drawnIn = !member && !!frame && solid && overlaps(shape.bounds, frame.bounds) && !Frames.within(plane, frame, shape);
      if (!member && !drawnIn) {
        if (frame && shape.label && overlaps(shape.label, frame.bounds)) labels.push(shape.label);
        continue;
      }
      if (solid) boxes.push(PlaneQuery.isLeaf(shape) && !shape.hostId ? this.placer.drawing(plane).unitBox(shape) : shape.bounds);
      if (shape.label) labels.push(shape.label);
    }
    if (plain) for (const edge of plane.edges.values()) if (edge.label) labels.push(edge.label);
    return { boxes, labels };
  }

  /** Groups drawn around one of the anchors: a node placed next to it may go inside them. */
  homeGroups(plane: Plane, anchors: ReadonlyArray<DShape | undefined>): string[] {
    const out: string[] = [];
    for (const group of plane.shapes.values()) {
      if (group.kind !== 'group') continue;
      if (anchors.some((anchor) => !!anchor && cx(anchor.bounds) > group.bounds.x && cx(anchor.bounds) < right(group.bounds) && cy(anchor.bounds) > group.bounds.y && cy(anchor.bounds) < bottom(group.bounds))) out.push(group.id);
    }
    return out;
  }

  isFree(box: Box, obs: { boxes: Box[]; labels: Box[] }, clearance = 20): boolean {
    return !obs.boxes.some((obstacle) => overlaps(obstacle, box, clearance)) && !obs.labels.some((label) => overlaps(label, box, 4));
  }

  /**
   * Where a space-tool run for a node goes: inside its expanded sub-process (frame mode: it never
   * grows over foreign shapes), else within its pool.
   * Without a pool, the smallest group around the anchor confines it like a pool would.
   */
  spaceBand(plane: Plane, shape: Pick<DShape, 'parentId' | 'poolId'>, anchor?: DShape): { within?: Box; frame?: string } {
    const sub = shape.parentId ? plane.shapes.get(shape.parentId) : undefined;
    if (sub) return { within: { ...sub.bounds }, frame: sub.id };
    const pool = shape.poolId ? plane.shapes.get(shape.poolId) : undefined;
    if (pool) return { within: { ...pool.bounds } };
    const group = anchor ? this.homeGroups(plane, [anchor]).map((id) => plane.shapes.get(id)!).sort((first, second) => first.bounds.width * first.bounds.height - second.bounds.width * second.bounds.height)[0] : undefined;
    return group ? { within: { ...group.bounds } } : {};
  }

  /** The centre of `b` lies inside `frame` (the plane: always). */
  private centreIn(box: Box, frame: DShape | undefined): boolean {
    if (!frame) return true;
    const frameBox = frame.bounds;
    return cx(box) > frameBox.x && cx(box) < right(frameBox) && cy(box) > frameBox.y && cy(box) < bottom(frameBox);
  }

  /**
   * Bottom of a frame's own content (members, what is drawn in it, labels of its connections), or
   * undefined when empty. A label or group elsewhere on the plane never counts.
   */
  contentBottom(plane: Plane, frame: DShape | undefined, exclude: ReadonlySet<string>): number | undefined {
    const obs = this.of(plane, frame, exclude, false);
    const member = (id: string | undefined): boolean => {
      const shape = id ? plane.shapes.get(id) : undefined;
      return !!shape && shape !== frame && this.within(plane, shape, frame);
    };
    const edgeLabels = [...plane.edges.values()].filter((edge) => edge.label && ((member(edge.sourceId) && member(edge.targetId)) || this.centreIn(edge.label, frame))).map((edge) => edge.label!);
    const groups = [...plane.shapes.values()].filter((group) => group.kind === 'group' && !exclude.has(group.id) && this.centreIn(group.bounds, frame)).map((group) => group.bounds);
    const all = [...obs.boxes, ...obs.labels, ...edgeLabels, ...groups];
    return all.length ? Math.max(...all.map(bottom)) : undefined;
  }

  /** Thin boxes of all edge segments (to keep new rows off existing lines). */
  edgeBoxes(plane: Plane): Box[] {
    const out: Box[] = [];
    for (const edge of plane.edges.values()) {
      for (let index = 0; index + 1 < edge.points.length; index++) {
        const start = edge.points[index]!;
        const end = edge.points[index + 1]!;
        out.push({ x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(start.x - end.x), height: Math.abs(start.y - end.y) });
      }
    }
    return out;
  }
}
