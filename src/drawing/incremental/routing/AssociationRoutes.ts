import { Box, BoxBorder, Point, Polyline } from '../../../model/index.js';
import type { DEdge } from '../../plane/DEdge.js';
import type { DShape } from '../../plane/DShape.js';
import type { Plane } from '../../plane/Plane.js';
import { Semantics } from '../../plane/Semantics.js';
import { EdgeDamage } from './EdgeDamage.js';
import { EdgeObstacles } from './EdgeObstacles.js';
import { OrthogonalRouter } from './OrthogonalRouter.js';
import { RouteCosts } from './RouteCosts.js';

interface Dock {
  at: Box;
  points?: Point[];
}

interface DockRequest {
  edge: DEdge;
  flow: DEdge;
  from: Box;
  obstacles: Box[];
  lines: readonly Point[][];
}

export class AssociationRoutes {
  private static readonly DOCK_CUT = 1e9;
  private static readonly DOCK_CROSSING = 1e6;
  private static readonly SHORTEST_DOCKED_RUN = 20;

  private readonly obstacles: EdgeObstacles;

  constructor(
    private readonly plane: Plane,
    private readonly damage: EdgeDamage,
  ) {
    this.obstacles = new EdgeObstacles(plane);
  }

  private static straight(from: Box, to: Box): Point[] {
    const start = new BoxBorder(from).pointTowards(to.center);
    const end = new BoxBorder(to).pointTowards(from.center);
    return new Polyline([start, end]).rounded();
  }

  private static dockBox(point: Point): Box {
    return new Box(Math.round(point.x), Math.round(point.y), 0, 0);
  }

  private static flowAnchor(edge: DEdge): Box | undefined {
    const longest = new Polyline(edge.points).segments().reduce<{ start: Point; end: Point; length: number } | undefined>((best, { start, end }) => {
      const length = Math.abs(start.x - end.x) + Math.abs(start.y - end.y);
      return !best || length > best.length ? { start, end, length } : best;
    }, undefined);
    return longest && new Box(Math.round((longest.start.x + longest.end.x) / 2), Math.round((longest.start.y + longest.end.y) / 2), 0, 0);
  }

  private static dockSpots(flow: DEdge, center: Point): Point[] {
    const spots = new Polyline(flow.points).segments().flatMap(({ start, end }) => {
      const nearest = EdgeDamage.nearestOn([start, end], center);
      return [...(nearest ? [nearest] : []), new Point((start.x + end.x) / 2, (start.y + end.y) / 2)];
    });
    const distance = (point: Point): number => Math.hypot(point.x - center.x, point.y - center.y);
    return spots.sort((first, second) => distance(first) - distance(second) || first.x - second.x || first.y - second.y);
  }

  private static plusLength(base: number, points: readonly Point[]): number {
    return new Polyline(points).segments().reduce((sum, { start, end }) => sum + Math.abs(end.x - start.x) + Math.abs(end.y - start.y), base);
  }

  route(edge: DEdge, lines: readonly Point[][]): Point[] | undefined {
    const source = edge.sourceId ? this.plane.shapes.get(edge.sourceId) : undefined;
    const target = edge.targetId ? this.plane.shapes.get(edge.targetId) : undefined;
    const sourceAnchor = this.anchorOf(edge.sourceId);
    const targetAnchor = this.anchorOf(edge.targetId);
    if (!sourceAnchor || !targetAnchor) {
      return undefined;
    }
    const docked = this.dockedRoute(edge, source, target, lines);
    if (docked) {
      return docked;
    }
    const line = AssociationRoutes.straight(sourceAnchor, targetAnchor);
    return source && target ? this.aroundObstacles(edge, source, target, line, lines) : line;
  }

  private aroundObstacles(edge: DEdge, source: DShape, target: DShape, line: Point[], lines: readonly Point[][]): Point[] {
    const obstacles = this.obstacles.around(edge, source, target);
    if (this.clear(edge, line, obstacles)) {
      return line;
    }
    const freeLines = Semantics.isAnnotationLine(edge.el) ? {} : { freeLines: this.obstacles.freeLines() };
    return new Polyline(OrthogonalRouter.route({ source: source.bounds, target: target.bounds, obstacles, lines, ...freeLines })).rounded();
  }

  private clear(edge: DEdge, line: readonly Point[], obstacles: readonly Box[]): boolean {
    const polyline = new Polyline(line);
    return !obstacles.some((obstacle) => polyline.hits(obstacle)) && !this.damage.touchesFresh(edge, line);
  }

  private dockedRoute(edge: DEdge, source: DShape | undefined, target: DShape | undefined, lines: readonly Point[][]): Point[] | undefined {
    const shape = source ?? target;
    const flow = this.plane.edges.get((source ? edge.targetId : edge.sourceId) ?? '');
    if (!shape || (source && target) || !flow || flow.points.length < 2) {
      return undefined;
    }
    const dock = this.flowDock({ edge, flow, from: shape.bounds, obstacles: this.obstacles.around(edge, shape), lines });
    if (dock?.points) {
      return source ? dock.points : dock.points.reverse();
    }
    if (!dock) {
      return undefined;
    }
    return source ? AssociationRoutes.straight(source.bounds, dock.at) : AssociationRoutes.straight(dock.at, shape.bounds);
  }

  private anchorOf(id: string | undefined): Box | undefined {
    if (!id) {
      return undefined;
    }
    const shape = this.plane.shapes.get(id);
    if (shape) {
      return shape.bounds;
    }
    const edge = this.plane.edges.get(id);
    return edge ? AssociationRoutes.flowAnchor(edge) : undefined;
  }

  private flowDock(request: DockRequest): Dock | undefined {
    const { edge, flow, from, obstacles } = request;
    for (const spot of AssociationRoutes.dockSpots(flow, from.center)) {
      const at = AssociationRoutes.dockBox(spot);
      if (this.clear(edge, AssociationRoutes.straight(from, at), obstacles)) {
        return { at };
      }
    }
    return this.routedDock(request);
  }

  private routedDock({ flow, from, obstacles, lines }: DockRequest): Dock | undefined {
    const center = from.center;
    const polylines = lines.map((line) => new Polyline(line));
    let best: Dock | undefined;
    let least = Number.POSITIVE_INFINITY;
    for (const { start, end } of new Polyline(flow.points).segments()) {
      const dx = Math.abs(start.x - end.x), dy = Math.abs(start.y - end.y);
      if (dx + dy < AssociationRoutes.SHORTEST_DOCKED_RUN && flow.points.length > 2) {
        continue;
      }
      const at = AssociationRoutes.dockBox(new Point((start.x + end.x) / 2, (start.y + end.y) / 2));
      const points = new Polyline(OrthogonalRouter.route({ source: from, target: at, obstacles, lines, targetSides: dx >= dy ? ['top', 'bottom'] : ['left', 'right'] })).rounded();
      const route = new Polyline(points);
      const nearest = EdgeDamage.nearestOn([start, end], center)!;
      const spread = Math.hypot(nearest.x - center.x, nearest.y - center.y) / AssociationRoutes.DOCK_CROSSING;
      const cost = AssociationRoutes.plusLength(AssociationRoutes.DOCK_CUT * obstacles.filter((obstacle) => route.hits(obstacle)).length + AssociationRoutes.DOCK_CROSSING * route.crossingCount(polylines) + RouteCosts.BEND * (points.length - 2) + spread, points);
      if (cost < least) {
        best = { at, points };
        least = cost;
      }
    }
    return best;
  }
}
