import { attachedSide, defaultSides, gatewaySide } from '../../drawing/utils/sides.js';
import { crossings } from '../../drawing/utils/routing.js';
import { OrthogonalRouter, type RouteRequest } from './OrthogonalRouter.js';
import type { Side, DEdge, DShape, Plane } from '../../drawing/types.js';
import { borderDistance, borderPoint, containsPoint, cx, cy, degenerate, isOrthogonal, pathHits, roundPoints, type Box, type Point } from '../../drawing/utils/geom.js';
import { PlaneQuery } from '../../drawing/PlaneQuery.js';

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

  private ancestors(s: DShape): Set<string> {
    const out = new Set<string>();
    let cur: DShape | undefined = s;
    for (let i = 0; cur && i < 12; i++) {
      for (const id of [cur.parentId, cur.laneId, cur.poolId]) if (id) out.add(id);
      cur = cur.parentId ? this.plane.shapes.get(cur.parentId) : undefined;
    }
    return out;
  }

  private commonFrame(s: DShape, t: DShape): Box | undefined {
    if (s.kind === 'participant' || t.kind === 'participant') return undefined;
    if (s.laneId && s.laneId === t.laneId && !s.parentId && !t.parentId) return this.plane.shapes.get(s.laneId)?.bounds;
    if (s.parentId && s.parentId === t.parentId) return this.plane.shapes.get(s.parentId)?.bounds;
    if (s.poolId && s.poolId === t.poolId) return this.plane.shapes.get(s.poolId)?.bounds;
    return undefined;
  }

  private sidesFor(s: DShape, role: 'source' | 'target'): Side[] {
    if (s.kind === 'boundary') {
      if (role === 'target') return defaultSides('boundary', 'target');
      const host = s.hostId ? this.plane.shapes.get(s.hostId) : undefined;
      return host ? [attachedSide(s.bounds, host.bounds)] : defaultSides('boundary', 'source');
    }
    return defaultSides(s.kind, role);
  }

  private gatewayEnds(e: DEdge, g: DShape, lines: readonly Point[][]): GatewayEnd[] {
    const settled = new Set(lines);
    const ends: GatewayEnd[] = [];
    for (const o of this.plane.edges.values()) {
      if (o === e || o.points.length < 2 || !settled.has(o.points)) continue;
      if (o.sourceId === g.id) ends.push({ side: gatewaySide(g.bounds, o.points[0]!), out: true });
      if (o.targetId === g.id) ends.push({ side: gatewaySide(g.bounds, o.points[o.points.length - 1]!), out: false });
    }
    return ends;
  }

  /**
   * With `shareEntries` a join's entries may share its top or bottom vertex;
   * sharing a left / right one would merge onto the other entry's line.
   */
  private takenSides(ends: readonly GatewayEnd[], shareEntries: boolean): Side[] {
    return [...new Set(ends.filter((x) => x.out || !shareEntries || x.side === 'left' || x.side === 'right').map((x) => x.side))];
  }

  private messageSides(from: Box, to: Box): Side[] {
    return cy(to) >= cy(from) ? ['bottom', 'top'] : ['top', 'bottom'];
  }

  private obstaclesFor(e: DEdge, ...ends: DShape[]): Box[] {
    const keepOut = new Set(ends.flatMap((x) => [x.id, ...this.ancestors(x)]));
    const out: Box[] = [];
    for (const o of this.plane.shapes.values()) {
      if (keepOut.has(o.id)) continue;
      if (PlaneQuery.isLeaf(o)) out.push(o.bounds);
      else if (o.kind === 'subProcess' && o.container) out.push(o.bounds);
      else if (e.kind === 'messageFlow' && o.kind === 'participant') out.push(o.bounds);
    }
    return out;
  }

  private straight(s: Box, t: Box): Point[] {
    const a = borderPoint(s, { x: cx(t), y: cy(t) });
    const b = borderPoint(t, { x: cx(s), y: cy(s) });
    return roundPoints([a, b]);
  }

  private anchorOf(id: string | undefined): Box | undefined {
    if (!id) return undefined;
    const s = this.plane.shapes.get(id);
    if (s) return s.bounds;
    const e = this.plane.edges.get(id);
    return e ? this.flowAnchor(e) : undefined;
  }

  private flowAnchor(e: DEdge): Box | undefined {
    let best: [Point, Point] | undefined;
    let len = -1;
    for (let i = 0; i + 1 < e.points.length; i++) {
      const p = e.points[i]!;
      const q = e.points[i + 1]!;
      const l = Math.abs(p.x - q.x) + Math.abs(p.y - q.y);
      if (l > len) {
        len = l;
        best = [p, q];
      }
    }
    if (!best) return undefined;
    return { x: Math.round((best[0].x + best[1].x) / 2), y: Math.round((best[0].y + best[1].y) / 2), width: 0, height: 0 };
  }

  private nearestOn(points: readonly Point[], p: Point): Point | undefined {
    let best: Point | undefined;
    let dist = Infinity;
    for (let i = 0; i + 1 < points.length; i++) {
      const a = points[i]!;
      const b = points[i + 1]!;
      const len = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
      const k = len ? Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / len)) : 0;
      const q = { x: a.x + k * (b.x - a.x), y: a.y + k * (b.y - a.y) };
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d < dist) {
        dist = d;
        best = q;
      }
    }
    return best;
  }

  /**
   * The nearest point of the flow a straight line from the shape reaches (`clear`),
   * else the middle of the nearest segment, entered across it (`sides`).
   */
  private flowDock(flow: DEdge, from: Box, obstacles: readonly Box[]): { at: Box; clear: boolean; sides?: Side[] } | undefined {
    const c = { x: cx(from), y: cy(from) };
    const cands: Point[] = [];
    for (let i = 0; i + 1 < flow.points.length; i++) {
      const a = flow.points[i]!;
      const b = flow.points[i + 1]!;
      const q = this.nearestOn([a, b], c);
      if (q) cands.push(q);
      cands.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    }
    const dist = (q: Point): number => Math.hypot(q.x - c.x, q.y - c.y);
    const box = (q: Point): Box => ({ x: Math.round(q.x), y: Math.round(q.y), width: 0, height: 0 });
    const sorted = cands.sort((p, r) => dist(p) - dist(r) || p.x - r.x || p.y - r.y);
    for (const q of sorted) if (!obstacles.some((o) => pathHits(this.straight(from, box(q)), o))) return { at: box(q), clear: true };
    let best: { at: Box; clear: boolean; sides?: Side[] } | undefined;
    let bestD = Infinity;
    for (let i = 0; i + 1 < flow.points.length; i++) {
      const a = flow.points[i]!;
      const b = flow.points[i + 1]!;
      if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) < 20 && flow.points.length > 2) continue;
      const d = dist(this.nearestOn([a, b], c)!);
      if (d >= bestD) continue;
      bestD = d;
      const horizontal = Math.abs(a.x - b.x) >= Math.abs(a.y - b.y);
      best = { at: box({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }), clear: false, sides: horizontal ? ['top', 'bottom'] : ['left', 'right'] };
    }
    return best;
  }

  /**
   * Message flows after sequence flows, so they see the final ones; connections docked on a
   * connection last, so they follow its final line.
   */
  routeRank(e: DEdge): number {
    if ((e.sourceId && this.plane.edges.has(e.sourceId)) || (e.targetId && this.plane.edges.has(e.targetId))) return 2;
    return e.kind === 'messageFlow' ? 1 : 0;
  }

  /** Every label counts as one diagonal line, so the router keeps off labels when that is cheap. */
  routingLines(except?: string): Point[][] {
    const out: Point[][] = [];
    for (const e of this.plane.edges.values()) {
      if (e.id === except) continue;
      if (e.points.length >= 2) out.push(e.points);
      if (e.label) out.push(this.diagonal(e.label));
    }
    for (const s of this.plane.shapes.values()) if (s.label) out.push(this.diagonal(s.label));
    return out;
  }

  private diagonal(b: Box): Point[] {
    return [
      { x: b.x, y: b.y },
      { x: b.x + b.width, y: b.y + b.height },
    ];
  }

  /**
   * Orthogonal route with the BPMN side conventions; associations go straight when that cuts
   * nothing. Undefined when an end has no shape on the plane.
   */
  routeEdge(e: DEdge, opts: RouteOptions): Point[] | undefined {
    const s = e.sourceId ? this.plane.shapes.get(e.sourceId) : undefined;
    const t = e.targetId ? this.plane.shapes.get(e.targetId) : undefined;
    if (e.kind === 'association' || e.kind === 'dataAssociation' || e.kind === 'other') {
      const sb = this.anchorOf(e.sourceId);
      const tb = this.anchorOf(e.targetId);
      if (!sb || !tb) return undefined;
      const shape = s ?? t;
      const flow = !s ? this.plane.edges.get(e.sourceId ?? '') : !t ? this.plane.edges.get(e.targetId ?? '') : undefined;
      if (shape && flow && flow.points.length >= 2) {
        const obstacles = this.obstaclesFor(e, shape);
        const dock = this.flowDock(flow, shape.bounds, obstacles);
        if (dock?.clear) return s ? this.straight(s.bounds, dock.at) : this.straight(dock.at, shape.bounds);
        if (dock) {
          const pts = roundPoints(OrthogonalRouter.route({ source: shape.bounds, target: dock.at, obstacles, lines: opts.lines, ...(dock.sides ? { targetSides: dock.sides } : {}) }));
          return s ? pts : pts.reverse();
        }
      }
      const line = this.straight(sb, tb);
      if (!s || !t) return line;
      const obstacles = this.obstaclesFor(e, s, t);
      if (!obstacles.some((o) => pathHits(line, o))) return line;
      return roundPoints(OrthogonalRouter.route({ source: s.bounds, target: t.bounds, obstacles, lines: opts.lines }));
    }
    if (!s || !t) return undefined;
    const obstacles = this.obstaclesFor(e, s, t);
    const message = e.kind === 'messageFlow';
    const frame = message ? undefined : this.commonFrame(s, t);
    const sourceSides = opts.sourceSides ?? (message ? this.messageSides(s.bounds, t.bounds) : this.sidesFor(s, 'source'));
    const targetSides = opts.targetSides ?? (message ? this.messageSides(t.bounds, s.bounds) : this.sidesFor(t, 'target'));
    // one connection per gateway vertex while one is free (explicit sides are taken as they are)
    const ends = (g: DShape): GatewayEnd[] => (g.kind === 'gateway' && !message ? this.gatewayEnds(e, g, opts.lines) : []);
    const targetEnds = ends(t);
    const taken = (shareEntries: boolean): Side[] => (opts.targetSides ? [] : this.takenSides(targetEnds, shareEntries));
    const request: RouteRequest = {
      source: s.bounds,
      target: t.bounds,
      sourceSides,
      targetSides,
      obstacles,
      lines: opts.lines,
      sourceMiddle: s.kind === 'gateway',
      targetMiddle: t.kind === 'gateway',
      sourceAvoid: opts.sourceSides ? [] : this.takenSides(ends(s), false),
      ...(frame ? { frame } : {}),
    };
    const pts = OrthogonalRouter.route({ ...request, targetAvoid: taken(false) });
    // a join's entries share its top / bottom vertex as in bpmn-js, but never for a crossing
    if (!targetEnds.some((x) => !x.out && (x.side === 'top' || x.side === 'bottom'))) return roundPoints(pts);
    const merged = OrthogonalRouter.route({ ...request, targetMerge: true, targetAvoid: taken(true) });
    return roundPoints(crossings(merged, opts.lines) <= crossings(pts, opts.lines) ? merged : pts);
  }

  /** For a message flow foreign pools count too; the frames around either end never do. */
  private cutShapes(e: DEdge, points: readonly Point[]): Set<string> {
    const ends = new Set([e.sourceId, e.targetId]);
    const s = e.sourceId ? this.plane.shapes.get(e.sourceId) : undefined;
    const t = e.targetId ? this.plane.shapes.get(e.targetId) : undefined;
    const around = new Set([...(s ? this.ancestors(s) : []), ...(t ? this.ancestors(t) : [])]);
    for (const end of [s, t]) {
      const host = end?.hostId ? this.plane.shapes.get(end.hostId) : undefined;
      if (host) for (const id of [host.id, ...this.ancestors(host)]) around.add(id);
    }
    const out = new Set<string>();
    for (const o of this.plane.shapes.values()) {
      if (ends.has(o.id) || around.has(o.id)) continue;
      if (o.hostId && ends.has(o.hostId)) continue;
      const solid = PlaneQuery.isLeaf(o) || (o.kind === 'subProcess' && o.container) || (e.kind === 'messageFlow' && o.kind === 'participant');
      if (solid && pathHits(points, o.bounds)) out.add(o.id);
    }
    return out;
  }

  private endGaps(e: DEdge): { sourceGap: number; targetGap: number } {
    const gapOf = (id: string | undefined, p: Point | undefined): number => {
      const s = id ? this.plane.shapes.get(id) : undefined;
      const on = !s && id ? this.plane.edges.get(id) : undefined;
      if (on && p && on.points.length >= 2) {
        const q = this.nearestOn(on.points, p);
        return q ? Math.hypot(q.x - p.x, q.y - p.y) : 0;
      }
      if (!s || !p) return 0;
      const d = borderDistance(s.bounds, p);
      const round = s.kind === 'event' || s.kind === 'boundary' || s.kind === 'gateway';
      return round ? Math.max(0, d - s.bounds.width / 2 + 1) : d;
    };
    return { sourceGap: gapOf(e.sourceId, e.points[0]), targetGap: gapOf(e.targetId, e.points[e.points.length - 1]) };
  }

  edgeBefore(e: DEdge): EdgeBefore {
    return { points: e.points.map((p) => ({ ...p })), cut: this.cutShapes(e, e.points), ...this.endGaps(e) };
  }

  /** Ends left at their shape's old place, e.g. by another tool or an older --no-layout write. */
  detachedEnds(e: DEdge): string[] {
    if (e.points.length < 2) return [];
    const out: string[] = [];
    for (const [id, p] of [
      [e.sourceId, e.points[0]!],
      [e.targetId, e.points[e.points.length - 1]!],
    ] as const) {
      const s = id ? this.plane.shapes.get(id) : undefined;
      if (s && !containsPoint(s.bounds, p, DETACHED_GAP)) out.push(s.id);
    }
    return out;
  }

  /**
   * Whether a kept connection must be rerouted: degenerate, detached, lost an end's border, turned
   * diagonal or newly cuts a shape. `detached: false` is for planes the layout may not route on.
   */
  brokenEdge(e: DEdge, before: EdgeBefore | undefined, { detached = true }: { detached?: boolean } = {}): boolean {
    if (degenerate(e.points)) return true;
    // broken even when it was already detached before
    if (detached && this.detachedEnds(e).length) return true;
    const tol = 3;
    const now = this.endGaps(e);
    if (now.sourceGap > Math.max(tol, (before?.sourceGap ?? 0) + 1)) return true;
    if (now.targetGap > Math.max(tol, (before?.targetGap ?? 0) + 1)) return true;
    const flow = e.kind === 'sequenceFlow' || e.kind === 'messageFlow';
    if (flow && !isOrthogonal(e.points) && (!before || isOrthogonal(before.points))) return true;
    const cut = this.cutShapes(e, e.points);
    for (const id of cut) if (!before?.cut.has(id)) return true;
    return false;
  }
}
