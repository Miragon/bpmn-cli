import { bottom, containsPoint, cx, cy, overlaps, right, segmentHits, type Box } from '../../utils/geom.js';
import { Frames } from '../../di/Frames.js';
import { PlaneQuery } from '../../di/PlaneQuery.js';

import type { DShape, Plane } from '../../di/types.js';
import type { NodePlacer } from './NodePlacer.js';

const CLEAR = 20;
const LABEL_CLEAR = 4;

/** A push of the space tool to the right, for a new node `id` at `box` or for a flow's target. */
export interface PushRequest {
  line: number;
  delta: number;
  /** moves with what follows it */
  successor: DShape | undefined;
  /** the new node and where it goes: what lies in the way moves too */
  id?: string;
  box?: Box;
  /** stays where it is, also beyond the line */
  fixed?: ReadonlySet<string>;
}

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

  /**
   * What a push at `line` by `delta` moves: `successor` and what follows it beyond the line (along
   * the drawn flows, so a batch pushes like the same ops sent one by one, and the paths of
   * boundary events) with what hangs on them (boundary events, content, associated artifacts, the
   * groups around them), and in turn what a pushed shape or the new node `id` at `box` would come
   * close to or put on a line, with what follows that. The connections listed bend with the push.
   * The rest beyond the line keeps its place: another row never moves for nothing, nor does a
   * shape in `fixed`.
   */
  pushSet(plane: Plane, req: PushRequest): Set<string> {
    const { line, delta, box, fixed } = req;
    const out = new Set<string>();
    const next = new Map<string, string[]>();
    const links = new Map<string, string[]>();
    const add = (map: Map<string, string[]>, from: string, to: string): void => void (map.get(from) ?? map.set(from, []).get(from)!).push(to);
    for (const edge of plane.edges.values()) {
      if (!edge.sourceId || !edge.targetId) continue;
      if (edge.kind === 'sequenceFlow') add(next, edge.sourceId, edge.targetId);
      if (edge.kind === 'association' || edge.kind === 'dataAssociation') {
        add(links, edge.sourceId, edge.targetId);
        add(links, edge.targetId, edge.sourceId);
      }
    }
    const movable = (shape: DShape): boolean =>
      !fixed?.has(shape.id) && !shape.hostId && !shape.parentId && shape.kind !== 'participant' && shape.kind !== 'lane' && shape.kind !== 'group' && (shape.bounds.x >= line || (shape.container && cx(shape.bounds) >= line));
    const queue: DShape[] = [];
    const take = (shape: DShape | undefined): void => {
      if (!shape || out.has(shape.id) || !movable(shape)) return;
      out.add(shape.id);
      queue.push(shape);
    };
    const drain = (): void => {
      for (let shape = queue.shift(); shape; shape = queue.shift()) {
        const dragged = [shape, ...PlaneQuery.boundariesOf(plane, shape.id), ...(shape.container ? PlaneQuery.contentOf(plane, shape.id).shapes : [])];
        dragged.forEach((part) => out.add(part.id));
        for (const part of dragged) {
          for (const target of next.get(part.id) ?? []) take(plane.shapes.get(target));
          for (const other of links.get(part.id) ?? []) {
            const artifact = plane.shapes.get(other);
            if (artifact?.kind === 'annotation' || artifact?.kind === 'data') take(artifact);
          }
        }
      }
    };
    take(req.successor);
    drain();

    /** the room a pushed box sweeps (the new node's box: itself) */
    const swept = (before: Box): Box => (before === box ? box : { ...before, width: before.width + delta });
    /**
     * newly close on the way of the push (what it jumps over counts too); a shape that was close
     * before counts when the push closes in on it
     */
    const closer = (before: Box, other: Box, margin: number): boolean => {
      if (!overlaps(swept(before), other, margin)) return false;
      return before === box || !overlaps(before, other, margin) || other.x >= right(before) - 1 || (overlaps(swept(before), other) && !overlaps(before, other));
    };
    for (let grew = true, guard = 0; grew && guard <= plane.shapes.size + plane.edges.size; guard++) {
      grew = false;
      const pushed = [...out].map((pushedId) => plane.shapes.get(pushedId)).filter((shape): shape is DShape => !!shape);
      const solids = [...(box ? [box] : []), ...pushed.map((shape) => shape.bounds)];
      const labels = pushed.flatMap((shape) => (shape.label ? [shape.label] : []));
      const hits = (other: Box, margin: number): boolean => solids.some((before) => closer(before, other, margin)) || labels.some((before) => closer(before, other, LABEL_CLEAR));
      for (const group of plane.shapes.values()) {
        if (group.kind !== 'group' || out.has(group.id) || !pushed.some((shape) => PlaneQuery.isLeaf(shape) && containsPoint(group.bounds, { x: cx(shape.bounds), y: cy(shape.bounds) }))) continue;
        out.add(group.id);
        grew = true;
        if (group.bounds.x < line) continue;
        for (const member of plane.shapes.values()) if (containsPoint(group.bounds, { x: cx(member.bounds), y: cy(member.bounds) })) take(member);
      }
      for (const shape of plane.shapes.values()) {
        if (out.has(shape.id) || !movable(shape)) continue;
        const own = [shape, ...PlaneQuery.boundariesOf(plane, shape.id)].flatMap((part) => (part.label ? [part.label] : []));
        if (!hits(this.placer.drawing(plane).unitBox(shape), CLEAR) && !own.some((label) => hits(label, LABEL_CLEAR))) continue;
        take(shape);
        grew = true;
      }
      for (const edge of plane.edges.values()) {
        if (out.has(edge.id) || [edge.sourceId, edge.targetId].some((end) => !end || end === req.id || out.has(end))) continue;
        const bendsInBox = !!box && edge.points.slice(1, -1).some((point) => overlaps({ ...point, width: 0, height: 0 }, box, 10));
        const crossed = edge.points.some((point, index) => index > 0 && solids.some((before) => segmentHits(edge.points[index - 1]!, point, swept(before)) && !(before !== box && segmentHits(edge.points[index - 1]!, point, before))));
        if (!bendsInBox && !crossed && !(edge.label && hits(edge.label, LABEL_CLEAR))) continue;
        out.add(edge.id);
        take(plane.shapes.get(edge.sourceId!));
        take(plane.shapes.get(edge.targetId!));
        grew = true;
      }
      drain();
    }
    return out;
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
