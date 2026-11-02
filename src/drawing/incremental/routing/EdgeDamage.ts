import { BoxBorder, Point, Polyline } from '../../../model/index.js';
import type { PlaneEdge } from '../../plane/PlaneEdge.js';
import type { PlaneShape } from '../../plane/PlaneShape.js';
import { Plane } from '../../plane/Plane.js';
import { EdgeObstacles } from './EdgeObstacles.js';

export interface EdgeBefore {
  points: Point[];
  cut: Set<string>;
  sourceGap: number;
  targetGap: number;
}

type EndGaps = Pick<EdgeBefore, 'sourceGap' | 'targetGap'>;

export interface GrazeOptions {
  points?: readonly Point[];
  margin?: number;
  labels?: boolean;
}

export class EdgeDamage {
  private static readonly GRAZE_GAP = 3;
  private static readonly GAP_TOLERANCE = 3;

  private readonly obstacles: EdgeObstacles;

  constructor(
    private readonly plane: Plane,
    private readonly fresh: ReadonlySet<string>,
  ) {
    this.obstacles = new EdgeObstacles(plane);
  }

  static nearestOn(points: readonly Point[], point: Point): Point | undefined {
    let best: Point | undefined;
    let least = Number.POSITIVE_INFINITY;
    for (let index = 0; index + 1 < points.length; index++) {
      const start = points[index]!, end = points[index + 1]!;
      const length = (end.x - start.x) ** 2 + (end.y - start.y) ** 2;
      const fraction = length ? Math.max(0, Math.min(1, ((point.x - start.x) * (end.x - start.x) + (point.y - start.y) * (end.y - start.y)) / length)) : 0;
      const projected = new Point(start.x + fraction * (end.x - start.x), start.y + fraction * (end.y - start.y));
      const distance = Math.hypot(projected.x - point.x, projected.y - point.y);
      if (distance < least) {
        least = distance;
        best = projected;
      }
    }
    return best;
  }

  grazes(edge: PlaneEdge, ids: Iterable<string>, { points = edge.points, margin = 1, labels = false }: GrazeOptions = {}): boolean {
    if (points.length < 2) {
      return false;
    }
    const own = this.ownShapes(edge);
    const line = new Polyline(points);
    for (const id of ids) {
      const shape = this.plane.shapes.get(id);
      if (shape && !own.has(id) && shape.isLeaf && (line.hits(shape.bounds, -margin) || (labels && shape.label && line.hits(shape.label, -margin)))) {
        return true;
      }
    }
    return false;
  }

  touchesFresh(edge: PlaneEdge, points: readonly Point[] = edge.points): boolean {
    return (edge.kind === 'association' || edge.kind === 'dataAssociation') && this.grazes(edge, this.fresh, { points, margin: EdgeDamage.GRAZE_GAP, labels: true });
  }

  edgeBefore(edge: PlaneEdge): EdgeBefore {
    return { points: new Polyline(edge.points).copy(), cut: this.cutShapes(edge), ...this.endGaps(edge) };
  }

  detachedEnds(edge: PlaneEdge): string[] {
    if (edge.points.length < 2) {
      return [];
    }
    const ends = [
      [edge.sourceId, edge.points[0]!],
      [edge.targetId, edge.points.at(-1)!],
    ] as const;
    return ends.flatMap(([id, point]) => {
      const shape = id ? this.plane.shapes.get(id) : undefined;
      return shape && !shape.bounds.contains(point, Plane.DETACHED_GAP) ? [shape.id] : [];
    });
  }

  broken(edge: PlaneEdge, before: EdgeBefore | undefined, detached: boolean): boolean {
    if (new Polyline(edge.points).rounded().length < 2 || (detached && this.detachedEnds(edge).length)) {
      return true;
    }
    return this.gapsGrew(edge, before) || this.lostRightAngles(edge, before) || [...this.cutShapes(edge)].some((id) => !before?.cut.has(id));
  }

  private gapsGrew(edge: PlaneEdge, before: EdgeBefore | undefined): boolean {
    const now = this.endGaps(edge);
    return now.sourceGap > Math.max(EdgeDamage.GAP_TOLERANCE, (before?.sourceGap ?? 0) + 1) || now.targetGap > Math.max(EdgeDamage.GAP_TOLERANCE, (before?.targetGap ?? 0) + 1);
  }

  private lostRightAngles(edge: PlaneEdge, before: EdgeBefore | undefined): boolean {
    const flow = edge.kind === 'sequenceFlow' || edge.kind === 'messageFlow';
    return flow && !new Polyline(edge.points).isOrthogonal() && (!before || new Polyline(before.points).isOrthogonal());
  }

  private ownShapes(edge: PlaneEdge): Set<string> {
    const own = new Set<string>();
    for (const end of [edge.sourceId, edge.targetId]) {
      const shape = end ? this.plane.shapes.get(end) : undefined;
      if (shape) {
        own.add(shape.id);
        if (shape.hostId) {
          own.add(shape.hostId);
        }
        for (const boundary of this.plane.boundariesOf(shape.id)) {
          own.add(boundary.id);
        }
      }
    }
    return own;
  }

  private surroundings(ends: ReadonlyArray<PlaneShape | undefined>): Set<string> {
    const around = new Set<string>();
    for (const end of ends) {
      for (const id of end ? this.obstacles.ancestors(end) : []) {
        around.add(id);
      }
    }
    for (const end of ends) {
      const host = end?.hostId ? this.plane.shapes.get(end.hostId) : undefined;
      for (const id of host ? [host.id, ...this.obstacles.ancestors(host)] : []) {
        around.add(id);
      }
    }
    return around;
  }

  private cutShapes(edge: PlaneEdge): Set<string> {
    const ends = new Set([edge.sourceId, edge.targetId]);
    const source = edge.sourceId ? this.plane.shapes.get(edge.sourceId) : undefined;
    const target = edge.targetId ? this.plane.shapes.get(edge.targetId) : undefined;
    const around = this.surroundings([source, target]);
    const line = new Polyline(edge.points);
    const cut = new Set<string>();
    for (const shape of this.plane.shapes.values()) {
      const onEnd = ends.has(shape.id) || around.has(shape.id) || (!!shape.hostId && ends.has(shape.hostId));
      if (!onEnd && EdgeObstacles.solidFor(shape, edge) && line.hits(shape.bounds)) {
        cut.add(shape.id);
      }
    }
    return cut;
  }

  private gapOf(id: string | undefined, point: Point | undefined): number {
    const shape = id ? this.plane.shapes.get(id) : undefined;
    const flow = !shape && id ? this.plane.edges.get(id) : undefined;
    if (flow && point && flow.points.length >= 2) {
      const nearest = EdgeDamage.nearestOn(flow.points, point);
      return nearest ? Math.hypot(nearest.x - point.x, nearest.y - point.y) : 0;
    }
    if (!shape || !point) {
      return 0;
    }
    const distance = new BoxBorder(shape.bounds).distanceTo(point);
    const round = shape.kind === 'event' || shape.kind === 'boundary' || shape.kind === 'gateway';
    return round ? Math.max(0, distance - shape.bounds.width / 2 + 1) : distance;
  }

  private endGaps(edge: PlaneEdge): EndGaps {
    return { sourceGap: this.gapOf(edge.sourceId, edge.points[0]), targetGap: this.gapOf(edge.targetId, edge.points.at(-1)) };
  }
}
