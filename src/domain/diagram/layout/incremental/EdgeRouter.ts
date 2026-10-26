import { attachedSide, defaultSides, gatewaySide } from '../../utils/sides.js';
import { crossings } from '../../utils/routing.js';
import { OrthogonalRouter, type RouteRequest } from './OrthogonalRouter.js';
import type { Side, DEdge, DShape, Plane } from '../../di/types.js';
import { borderDistance, borderPoint, containsPoint, cx, cy, degenerate, isOrthogonal, pathHits, roundPoints, type Box, type Point } from '../../utils/geom.js';
import { PlaneQuery } from '../../di/PlaneQuery.js';

export interface RouteOptions {
  lines: Point[][];
  sourceSides?: Side[];
  targetSides?: Side[];
}

/** A gateway vertex another connection docks on; `out`: it leaves the gateway there. */
interface GatewayEnd {
  side: Side;
  out: boolean;
}

export interface EdgeBefore {
  points: Point[];
  cut: Set<string>;
  sourceGap: number;
  targetGap: number;
}

/** The `detachedEdge` metric uses the same gap. */
export const DETACHED_GAP = 10;

/** Routes and repairs single connections inside a kept drawing. */
export class EdgeRouter {
  constructor(private readonly plane: Plane) {}

  private ancestors(shape: DShape): Set<string> {
    const out = new Set<string>();
    let cur: DShape | undefined = shape;
    for (let depth = 0; cur && depth < 12; depth++) {
      for (const id of [cur.parentId, cur.laneId, cur.poolId]) if (id) out.add(id);
      cur = cur.parentId ? this.plane.shapes.get(cur.parentId) : undefined;
    }
    return out;
  }

  private commonFrame(source: DShape, target: DShape): Box | undefined {
    if (source.kind === 'participant' || target.kind === 'participant') return undefined;
    if (source.laneId && source.laneId === target.laneId && !source.parentId && !target.parentId) return this.plane.shapes.get(source.laneId)?.bounds;
    if (source.parentId && source.parentId === target.parentId) return this.plane.shapes.get(source.parentId)?.bounds;
    if (source.poolId && source.poolId === target.poolId) return this.plane.shapes.get(source.poolId)?.bounds;
    return undefined;
  }

  private sidesFor(shape: DShape, role: 'source' | 'target'): Side[] {
    if (shape.kind === 'boundary') {
      if (role === 'target') return defaultSides('boundary', 'target');
      const host = shape.hostId ? this.plane.shapes.get(shape.hostId) : undefined;
      return host ? [attachedSide(shape.bounds, host.bounds)] : defaultSides('boundary', 'source');
    }
    return defaultSides(shape.kind, role);
  }

  private gatewayEnds(edge: DEdge, gateway: DShape, lines: readonly Point[][]): GatewayEnd[] {
    const settled = new Set(lines);
    const ends: GatewayEnd[] = [];
    for (const other of this.plane.edges.values()) {
      if (other === edge || other.points.length < 2 || !settled.has(other.points)) continue;
      if (other.sourceId === gateway.id) ends.push({ side: gatewaySide(gateway.bounds, other.points[0]!), out: true });
      if (other.targetId === gateway.id) ends.push({ side: gatewaySide(gateway.bounds, other.points[other.points.length - 1]!), out: false });
    }
    return ends;
  }

  /**
   * With `shareEntries` a join's entries may share its top or bottom vertex;
   * sharing a left / right one would merge onto the other entry's line.
   */
  private takenSides(ends: readonly GatewayEnd[], shareEntries: boolean): Side[] {
    return [...new Set(ends.filter((end) => end.out || !shareEntries || end.side === 'left' || end.side === 'right').map((end) => end.side))];
  }

  private messageSides(from: Box, to: Box): Side[] {
    return cy(to) >= cy(from) ? ['bottom', 'top'] : ['top', 'bottom'];
  }

  private obstaclesFor(edge: DEdge, ...ends: DShape[]): Box[] {
    const keepOut = new Set(ends.flatMap((end) => [end.id, ...this.ancestors(end)]));
    const out: Box[] = [];
    for (const shape of this.plane.shapes.values()) {
      if (keepOut.has(shape.id)) continue;
      if (PlaneQuery.isLeaf(shape)) out.push(shape.bounds);
      else if (shape.kind === 'subProcess' && shape.container) out.push(shape.bounds);
      else if (edge.kind === 'messageFlow' && shape.kind === 'participant') out.push(shape.bounds);
    }
    return out;
  }

  private straight(from: Box, to: Box): Point[] {
    const start = borderPoint(from, { x: cx(to), y: cy(to) });
    const end = borderPoint(to, { x: cx(from), y: cy(from) });
    return roundPoints([start, end]);
  }

  private anchorOf(id: string | undefined): Box | undefined {
    if (!id) return undefined;
    const shape = this.plane.shapes.get(id);
    if (shape) return shape.bounds;
    const edge = this.plane.edges.get(id);
    return edge ? this.flowAnchor(edge) : undefined;
  }

  private flowAnchor(edge: DEdge): Box | undefined {
    let best: [Point, Point] | undefined;
    let len = -1;
    for (let index = 0; index + 1 < edge.points.length; index++) {
      const start = edge.points[index]!;
      const end = edge.points[index + 1]!;
      const length = Math.abs(start.x - end.x) + Math.abs(start.y - end.y);
      if (length > len) {
        len = length;
        best = [start, end];
      }
    }
    if (!best) return undefined;
    return { x: Math.round((best[0].x + best[1].x) / 2), y: Math.round((best[0].y + best[1].y) / 2), width: 0, height: 0 };
  }

  private nearestOn(points: readonly Point[], point: Point): Point | undefined {
    let best: Point | undefined;
    let dist = Infinity;
    for (let index = 0; index + 1 < points.length; index++) {
      const start = points[index]!;
      const end = points[index + 1]!;
      const len = (end.x - start.x) ** 2 + (end.y - start.y) ** 2;
      const fraction = len ? Math.max(0, Math.min(1, ((point.x - start.x) * (end.x - start.x) + (point.y - start.y) * (end.y - start.y)) / len)) : 0;
      const projected = { x: start.x + fraction * (end.x - start.x), y: start.y + fraction * (end.y - start.y) };
      const distance = Math.hypot(projected.x - point.x, projected.y - point.y);
      if (distance < dist) {
        dist = distance;
        best = projected;
      }
    }
    return best;
  }

  /**
   * The nearest point of the flow a straight line from the shape reaches (`clear`),
   * else the middle of the nearest segment, entered across it (`sides`).
   */
  private flowDock(flow: DEdge, from: Box, obstacles: readonly Box[]): { at: Box; clear: boolean; sides?: Side[] } | undefined {
    const center = { x: cx(from), y: cy(from) };
    const cands: Point[] = [];
    for (let index = 0; index + 1 < flow.points.length; index++) {
      const start = flow.points[index]!;
      const end = flow.points[index + 1]!;
      const nearest = this.nearestOn([start, end], center);
      if (nearest) cands.push(nearest);
      cands.push({ x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 });
    }
    const dist = (point: Point): number => Math.hypot(point.x - center.x, point.y - center.y);
    const box = (point: Point): Box => ({ x: Math.round(point.x), y: Math.round(point.y), width: 0, height: 0 });
    const sorted = cands.sort((first, second) => dist(first) - dist(second) || first.x - second.x || first.y - second.y);
    for (const candidate of sorted) if (!obstacles.some((obstacle) => pathHits(this.straight(from, box(candidate)), obstacle))) return { at: box(candidate), clear: true };
    let best: { at: Box; clear: boolean; sides?: Side[] } | undefined;
    let bestD = Infinity;
    for (let index = 0; index + 1 < flow.points.length; index++) {
      const start = flow.points[index]!;
      const end = flow.points[index + 1]!;
      if (Math.abs(start.x - end.x) + Math.abs(start.y - end.y) < 20 && flow.points.length > 2) continue;
      const distance = dist(this.nearestOn([start, end], center)!);
      if (distance >= bestD) continue;
      bestD = distance;
      const horizontal = Math.abs(start.x - end.x) >= Math.abs(start.y - end.y);
      best = { at: box({ x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }), clear: false, sides: horizontal ? ['top', 'bottom'] : ['left', 'right'] };
    }
    return best;
  }

  /**
   * Message flows after sequence flows, so they see the final ones; connections docked on a
   * connection last, so they follow its final line.
   */
  routeRank(edge: DEdge): number {
    if ((edge.sourceId && this.plane.edges.has(edge.sourceId)) || (edge.targetId && this.plane.edges.has(edge.targetId))) return 2;
    return edge.kind === 'messageFlow' ? 1 : 0;
  }

  /** Every label counts as one diagonal line, so the router keeps off labels when that is cheap. */
  routingLines(except?: string): Point[][] {
    const out: Point[][] = [];
    for (const edge of this.plane.edges.values()) {
      if (edge.id === except) continue;
      if (edge.points.length >= 2) out.push(edge.points);
      if (edge.label) out.push(this.diagonal(edge.label));
    }
    for (const shape of this.plane.shapes.values()) if (shape.label) out.push(this.diagonal(shape.label));
    return out;
  }

  private diagonal(box: Box): Point[] {
    return [
      { x: box.x, y: box.y },
      { x: box.x + box.width, y: box.y + box.height },
    ];
  }

  /**
   * Orthogonal route with the BPMN side conventions; associations go straight when that cuts
   * nothing. Undefined when an end has no shape on the plane.
   * A gateway takes one connection per vertex while one is free (explicit sides are taken as they
   * are); a join's entries may share its top / bottom vertex as in bpmn-js when that adds no
   * crossing.
   */
  routeEdge(edge: DEdge, opts: RouteOptions): Point[] | undefined {
    const source = edge.sourceId ? this.plane.shapes.get(edge.sourceId) : undefined;
    const target = edge.targetId ? this.plane.shapes.get(edge.targetId) : undefined;
    if (edge.kind === 'association' || edge.kind === 'dataAssociation' || edge.kind === 'other') {
      const sb = this.anchorOf(edge.sourceId);
      const tb = this.anchorOf(edge.targetId);
      if (!sb || !tb) return undefined;
      const shape = source ?? target;
      const flow = !source ? this.plane.edges.get(edge.sourceId ?? '') : !target ? this.plane.edges.get(edge.targetId ?? '') : undefined;
      if (shape && flow && flow.points.length >= 2) {
        const obstacles = this.obstaclesFor(edge, shape);
        const dock = this.flowDock(flow, shape.bounds, obstacles);
        if (dock?.clear) return source ? this.straight(source.bounds, dock.at) : this.straight(dock.at, shape.bounds);
        if (dock) {
          const pts = roundPoints(OrthogonalRouter.route({ source: shape.bounds, target: dock.at, obstacles, lines: opts.lines, ...(dock.sides ? { targetSides: dock.sides } : {}) }));
          return source ? pts : pts.reverse();
        }
      }
      const line = this.straight(sb, tb);
      if (!source || !target) return line;
      const obstacles = this.obstaclesFor(edge, source, target);
      if (!obstacles.some((obstacle) => pathHits(line, obstacle))) return line;
      return roundPoints(OrthogonalRouter.route({ source: source.bounds, target: target.bounds, obstacles, lines: opts.lines }));
    }
    if (!source || !target) return undefined;
    const obstacles = this.obstaclesFor(edge, source, target);
    const message = edge.kind === 'messageFlow';
    const frame = message ? undefined : this.commonFrame(source, target);
    const sourceSides = opts.sourceSides ?? (message ? this.messageSides(source.bounds, target.bounds) : this.sidesFor(source, 'source'));
    const targetSides = opts.targetSides ?? (message ? this.messageSides(target.bounds, source.bounds) : this.sidesFor(target, 'target'));
    const ends = (gateway: DShape): GatewayEnd[] => (gateway.kind === 'gateway' && !message ? this.gatewayEnds(edge, gateway, opts.lines) : []);
    const targetEnds = ends(target);
    const taken = (shareEntries: boolean): Side[] => (opts.targetSides ? [] : this.takenSides(targetEnds, shareEntries));
    const request: RouteRequest = {
      source: source.bounds,
      target: target.bounds,
      sourceSides,
      targetSides,
      obstacles,
      lines: opts.lines,
      sourceMiddle: source.kind === 'gateway',
      targetMiddle: target.kind === 'gateway',
      sourceAvoid: opts.sourceSides ? [] : this.takenSides(ends(source), false),
      ...(frame ? { frame } : {}),
    };
    const pts = OrthogonalRouter.route({ ...request, targetAvoid: taken(false) });
    if (!targetEnds.some((end) => !end.out && (end.side === 'top' || end.side === 'bottom'))) return roundPoints(pts);
    const merged = OrthogonalRouter.route({ ...request, targetMerge: true, targetAvoid: taken(true) });
    return roundPoints(crossings(merged, opts.lines) <= crossings(pts, opts.lines) ? merged : pts);
  }

  /** For a message flow foreign pools count too; the frames around either end never do. */
  private cutShapes(edge: DEdge, points: readonly Point[]): Set<string> {
    const ends = new Set([edge.sourceId, edge.targetId]);
    const source = edge.sourceId ? this.plane.shapes.get(edge.sourceId) : undefined;
    const target = edge.targetId ? this.plane.shapes.get(edge.targetId) : undefined;
    const around = new Set([...(source ? this.ancestors(source) : []), ...(target ? this.ancestors(target) : [])]);
    for (const end of [source, target]) {
      const host = end?.hostId ? this.plane.shapes.get(end.hostId) : undefined;
      if (host) for (const id of [host.id, ...this.ancestors(host)]) around.add(id);
    }
    const out = new Set<string>();
    for (const shape of this.plane.shapes.values()) {
      if (ends.has(shape.id) || around.has(shape.id)) continue;
      if (shape.hostId && ends.has(shape.hostId)) continue;
      const solid = PlaneQuery.isLeaf(shape) || (shape.kind === 'subProcess' && shape.container) || (edge.kind === 'messageFlow' && shape.kind === 'participant');
      if (solid && pathHits(points, shape.bounds)) out.add(shape.id);
    }
    return out;
  }

  private endGaps(edge: DEdge): { sourceGap: number; targetGap: number } {
    const gapOf = (id: string | undefined, point: Point | undefined): number => {
      const shape = id ? this.plane.shapes.get(id) : undefined;
      const on = !shape && id ? this.plane.edges.get(id) : undefined;
      if (on && point && on.points.length >= 2) {
        const nearest = this.nearestOn(on.points, point);
        return nearest ? Math.hypot(nearest.x - point.x, nearest.y - point.y) : 0;
      }
      if (!shape || !point) return 0;
      const distance = borderDistance(shape.bounds, point);
      const round = shape.kind === 'event' || shape.kind === 'boundary' || shape.kind === 'gateway';
      return round ? Math.max(0, distance - shape.bounds.width / 2 + 1) : distance;
    };
    return { sourceGap: gapOf(edge.sourceId, edge.points[0]), targetGap: gapOf(edge.targetId, edge.points[edge.points.length - 1]) };
  }

  edgeBefore(edge: DEdge): EdgeBefore {
    return { points: edge.points.map((point) => ({ ...point })), cut: this.cutShapes(edge, edge.points), ...this.endGaps(edge) };
  }

  /** Ends left at their shape's old place, e.g. by another tool or an older --no-layout write. */
  detachedEnds(edge: DEdge): string[] {
    if (edge.points.length < 2) return [];
    const out: string[] = [];
    for (const [id, point] of [
      [edge.sourceId, edge.points[0]!],
      [edge.targetId, edge.points[edge.points.length - 1]!],
    ] as const) {
      const shape = id ? this.plane.shapes.get(id) : undefined;
      if (shape && !containsPoint(shape.bounds, point, DETACHED_GAP)) out.push(shape.id);
    }
    return out;
  }

  /**
   * Whether a kept connection must be rerouted: degenerate, detached, lost an end's border, turned
   * diagonal or newly cuts a shape. `detached: false` is for planes the layout may not route on.
   * Detached ends count even when they were detached before.
   */
  brokenEdge(edge: DEdge, before: EdgeBefore | undefined, { detached = true }: { detached?: boolean } = {}): boolean {
    if (degenerate(edge.points)) return true;
    if (detached && this.detachedEnds(edge).length) return true;
    const tol = 3;
    const now = this.endGaps(edge);
    if (now.sourceGap > Math.max(tol, (before?.sourceGap ?? 0) + 1)) return true;
    if (now.targetGap > Math.max(tol, (before?.targetGap ?? 0) + 1)) return true;
    const flow = edge.kind === 'sequenceFlow' || edge.kind === 'messageFlow';
    if (flow && !isOrthogonal(edge.points) && (!before || isOrthogonal(before.points))) return true;
    const cut = this.cutShapes(edge, edge.points);
    for (const id of cut) if (!before?.cut.has(id)) return true;
    return false;
  }
}
