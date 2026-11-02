import { Point, Polyline, type Box } from '../../../model/index.js';
import type { PlaneEdge } from '../../plane/PlaneEdge.js';
import type { PlaneShape } from '../../plane/PlaneShape.js';
import type { Plane } from '../../plane/Plane.js';
import { ShapeSides, type Side } from '../../plane/ShapeSides.js';
import { AssociationRoutes } from './AssociationRoutes.js';
import { EdgeDamage, type EdgeBefore } from './EdgeDamage.js';
import { EdgeObstacles } from './EdgeObstacles.js';
import { OrthogonalRouter } from './OrthogonalRouter.js';
import type { RouteRequest } from './RouteScene.js';

export type { EdgeBefore } from './EdgeDamage.js';

export interface RouteOptions {
  lines: Point[][];
  sourceSides?: Side[] | undefined;
  targetSides?: Side[] | undefined;
}

interface GatewayEnd {
  side: Side;
  out: boolean;
}

export class EdgeRouter {
  private readonly damage: EdgeDamage;
  private readonly associations: AssociationRoutes;
  private readonly obstacles: EdgeObstacles;

  constructor(
    private readonly plane: Plane,
    fresh: ReadonlySet<string> = new Set(),
  ) {
    this.damage = new EdgeDamage(plane, fresh);
    this.associations = new AssociationRoutes(plane, this.damage);
    this.obstacles = new EdgeObstacles(plane);
  }

  private static takenSides(ends: readonly GatewayEnd[], shareEntries: boolean): Side[] {
    return [...new Set(ends.filter((end) => end.out || !shareEntries || end.side === 'left' || end.side === 'right').map((end) => end.side))];
  }

  private static messageSides(from: Box, to: Box): Side[] {
    return to.center.y >= from.center.y ? ['bottom', 'top'] : ['top', 'bottom'];
  }

  private static diagonal(box: Box): Point[] {
    return [new Point(box.x, box.y), new Point(box.right, box.bottom)];
  }

  routeRank(edge: PlaneEdge): number {
    if ((edge.sourceId && this.plane.edges.has(edge.sourceId)) || (edge.targetId && this.plane.edges.has(edge.targetId))) {
      return 2;
    }
    return edge.kind === 'messageFlow' ? 1 : 0;
  }

  routingLines(except?: string): Point[][] {
    const lines: Point[][] = [];
    for (const edge of this.plane.edges.values()) {
      if (edge.id === except) {
        continue;
      }
      if (edge.points.length >= 2) {
        lines.push(edge.points);
      }
      if (edge.label) {
        lines.push(EdgeRouter.diagonal(edge.label));
      }
    }
    for (const shape of this.plane.shapes.values()) {
      if (shape.label) {
        lines.push(EdgeRouter.diagonal(shape.label));
      }
    }
    return lines;
  }

  routeEdge(edge: PlaneEdge, opts: RouteOptions): Point[] | undefined {
    if (edge.kind === 'association' || edge.kind === 'dataAssociation' || edge.kind === 'other') {
      return this.associations.route(edge, opts.lines);
    }
    const source = edge.sourceId ? this.plane.shapes.get(edge.sourceId) : undefined;
    const target = edge.targetId ? this.plane.shapes.get(edge.targetId) : undefined;
    return source && target ? this.routeFlow(edge, source, target, opts) : undefined;
  }

  grazes(edge: PlaneEdge, ids: Iterable<string>): boolean {
    return this.damage.grazes(edge, ids);
  }

  touchesFresh(edge: PlaneEdge): boolean {
    return this.damage.touchesFresh(edge);
  }

  edgeBefore(edge: PlaneEdge): EdgeBefore {
    return this.damage.edgeBefore(edge);
  }

  detachedEnds(edge: PlaneEdge): string[] {
    return this.damage.detachedEnds(edge);
  }

  brokenEdge(edge: PlaneEdge, before: EdgeBefore | undefined, { detached = true }: { detached?: boolean } = {}): boolean {
    return this.damage.broken(edge, before, detached);
  }

  private commonFrame(source: PlaneShape, target: PlaneShape): Box | undefined {
    if (source.kind === 'participant' || target.kind === 'participant') {
      return undefined;
    }
    if (source.laneId && source.laneId === target.laneId && !source.parentId && !target.parentId) {
      return this.plane.shapes.get(source.laneId)?.bounds;
    }
    if (source.parentId && source.parentId === target.parentId) {
      return this.plane.shapes.get(source.parentId)?.bounds;
    }
    if (source.poolId && source.poolId === target.poolId) {
      return this.plane.shapes.get(source.poolId)?.bounds;
    }
    return undefined;
  }

  private sidesFor(shape: PlaneShape, role: 'source' | 'target'): Side[] {
    const host = shape.kind === 'boundary' && role === 'source' && shape.hostId ? this.plane.shapes.get(shape.hostId) : undefined;
    return host ? [ShapeSides.attached(shape.bounds, host.bounds)] : ShapeSides.of(shape.kind, role);
  }

  private gatewayEnds(edge: PlaneEdge, gateway: PlaneShape, lines: readonly Point[][]): GatewayEnd[] {
    const settled = new Set(lines);
    const ends: GatewayEnd[] = [];
    for (const other of this.plane.edges.values()) {
      if (other === edge || other.points.length < 2 || !settled.has(other.points)) {
        continue;
      }
      if (other.sourceId === gateway.id) {
        ends.push({ side: ShapeSides.ofGateway(gateway.bounds, other.points[0]!), out: true });
      }
      if (other.targetId === gateway.id) {
        ends.push({ side: ShapeSides.ofGateway(gateway.bounds, other.points.at(-1)!), out: false });
      }
    }
    return ends;
  }

  private routeFlow(edge: PlaneEdge, source: PlaneShape, target: PlaneShape, opts: RouteOptions): Point[] {
    const message = edge.kind === 'messageFlow';
    const frame = message ? undefined : this.commonFrame(source, target);
    const ends = (gateway: PlaneShape): GatewayEnd[] => (gateway.kind === 'gateway' && !message ? this.gatewayEnds(edge, gateway, opts.lines) : []);
    const targetEnds = ends(target);
    const taken = (shareEntries: boolean): Side[] => (opts.targetSides ? [] : EdgeRouter.takenSides(targetEnds, shareEntries));
    const freeLines = this.obstacles.freeLines();
    const request: RouteRequest = {
      source: source.bounds,
      target: target.bounds,
      sourceSides: opts.sourceSides ?? (message ? EdgeRouter.messageSides(source.bounds, target.bounds) : this.sidesFor(source, 'source')),
      targetSides: opts.targetSides ?? (message ? EdgeRouter.messageSides(target.bounds, source.bounds) : this.sidesFor(target, 'target')),
      obstacles: this.obstacles.around(edge, source, target),
      lines: opts.lines,
      freeLines,
      sourceMiddle: source.kind === 'gateway',
      targetMiddle: target.kind === 'gateway',
      sourceAvoid: opts.sourceSides ? [] : EdgeRouter.takenSides(ends(source), false),
      ...(frame ? { frame } : {}),
    };
    const separate = OrthogonalRouter.route({ ...request, targetAvoid: taken(false) });
    if (!targetEnds.some((end) => !end.out && (end.side === 'top' || end.side === 'bottom'))) {
      return new Polyline(separate).rounded();
    }
    const merged = OrthogonalRouter.route({ ...request, targetMerge: true, targetAvoid: taken(true) });
    const counted = opts.lines.filter((line) => !freeLines.has(line)).map((line) => new Polyline(line));
    return new Polyline(new Polyline(merged).crossingCount(counted) <= new Polyline(separate).crossingCount(counted) ? merged : separate).rounded();
  }
}
