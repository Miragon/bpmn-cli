/**
 * Routing and repair of single connections inside a kept drawing.
 *
 * CONTRACT
 *  - routeEdge(plane, edge, {lines, sourceSides?, targetSides?}) returns new
 *    waypoints for one connection, from the router (router.ts) with the BPMN
 *    side conventions (activities / gateways exit right/bottom/top and enter
 *    left/bottom/top, events any side, a boundary event leaves through the
 *    border it sits on, message flows leave / enter vertically). A gateway
 *    end docks on a vertex of the diamond (the middle of a side), preferably
 *    one no other connection of the gateway uses (a split's branches: one per
 *    vertex, a join's entries likewise): a taken vertex costs the router 100
 *    extra, so it is shared only when every free one costs more than that
 *    (a detour with a further bend and a crossing does; one crossing instead
 *    of running on top of the other connection does not). Connections count
 *    as using a vertex when they are among
 *    `lines` (connections waiting to be routed again are left out of `lines`
 *    by the caller). Explicit `sourceSides` / `targetSides` are taken as they
 *    are. Obstacles are
 *    the leaf shapes and the expanded sub-processes that hold neither end;
 *    message flows also avoid foreign pools. The frame is the common lane,
 *    else the common expanded sub-process, else the common pool. Associations
 *    and data associations are a straight line when that cuts nothing, else
 *    routed. Undefined when an end has no shape on the plane.
 *  - brokenEdge(plane, edge, before) says whether a kept connection must be
 *    rerouted: it has fewer than two distinct waypoints (zero length, e.g.
 *    both ends were pushed onto one point), an end lost its shape's border,
 *    it became diagonal (it was orthogonal before), or it now cuts a shape it
 *    did not cut before (a leaf shape, an expanded sub-process holding
 *    neither end, for a message flow a pool other than its ends' pools).
 */
import { attachedSide, defaultSides, routeOrthogonal, type Side } from './router.js';
import { borderDistance, borderPoint, cx, cy, degenerate, isOrthogonal, pathHits, roundPoints, type Box, type Point } from './geom.js';
import { isLeaf, type DEdge, type DShape, type Plane } from './plane.js';

export interface RouteOptions {
  /** other connections of the plane (crossing them costs) */
  lines: Point[][];
  sourceSides?: Side[];
  targetSides?: Side[];
}

/** Ancestors of a shape (expanded sub-processes, lanes, pool) by id. */
function ancestors(plane: Plane, s: DShape): Set<string> {
  const out = new Set<string>();
  let cur: DShape | undefined = s;
  for (let i = 0; cur && i < 12; i++) {
    for (const id of [cur.parentId, cur.laneId, cur.poolId]) if (id) out.add(id);
    cur = cur.parentId ? plane.shapes.get(cur.parentId) : undefined;
  }
  return out;
}

function commonFrame(plane: Plane, s: DShape, t: DShape): Box | undefined {
  if (s.kind === 'participant' || t.kind === 'participant') return undefined;
  if (s.laneId && s.laneId === t.laneId && !s.parentId && !t.parentId) return plane.shapes.get(s.laneId)?.bounds;
  if (s.parentId && s.parentId === t.parentId) return plane.shapes.get(s.parentId)?.bounds;
  if (s.poolId && s.poolId === t.poolId) return plane.shapes.get(s.poolId)?.bounds;
  return undefined;
}

function sidesFor(plane: Plane, s: DShape, role: 'source' | 'target'): Side[] {
  if (s.kind === 'boundary') {
    if (role === 'target') return defaultSides('boundary', 'target');
    const host = s.hostId ? plane.shapes.get(s.hostId) : undefined;
    return host ? [attachedSide(s.bounds, host.bounds)] : defaultSides('boundary', 'source');
  }
  return defaultSides(s.kind, role);
}

/**
 * The side of a gateway a docking point lies on: the vertex it is nearest to
 * (by the diamond's own proportions).
 */
export function gatewaySide(b: Box, p: Point): Side {
  const dx = (p.x - cx(b)) / Math.max(1, b.width / 2);
  const dy = (p.y - cy(b)) / Math.max(1, b.height / 2);
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'bottom' : 'top';
}

/** Sides of a gateway other settled connections (among `lines`) dock on. */
function usedSides(plane: Plane, e: DEdge, g: DShape, lines: readonly Point[][]): Set<Side> {
  const settled = new Set(lines);
  const out = new Set<Side>();
  for (const o of plane.edges.values()) {
    if (o === e || o.points.length < 2 || !settled.has(o.points)) continue;
    if (o.sourceId === g.id) out.add(gatewaySide(g.bounds, o.points[0]!));
    if (o.targetId === g.id) out.add(gatewaySide(g.bounds, o.points[o.points.length - 1]!));
  }
  return out;
}

function messageSides(from: Box, to: Box): Side[] {
  return cy(to) >= cy(from) ? ['bottom', 'top'] : ['top', 'bottom'];
}

function obstaclesFor(plane: Plane, e: DEdge, s: DShape, t: DShape): Box[] {
  const keepOut = new Set([s.id, t.id, ...ancestors(plane, s), ...ancestors(plane, t)]);
  const out: Box[] = [];
  for (const o of plane.shapes.values()) {
    if (keepOut.has(o.id)) continue;
    if (isLeaf(o)) out.push(o.bounds);
    else if (o.kind === 'subProcess' && o.container) out.push(o.bounds);
    else if (e.kind === 'messageFlow' && o.kind === 'participant') out.push(o.bounds);
  }
  return out;
}

function straight(s: Box, t: Box): Point[] {
  const a = borderPoint(s, { x: cx(t), y: cy(t) });
  const b = borderPoint(t, { x: cx(s), y: cy(s) });
  return roundPoints([a, b]);
}

/** Where a connection end docks: the shape, else the middle of the longest segment of a flow. */
function anchorOf(plane: Plane, id: string | undefined): Box | undefined {
  if (!id) return undefined;
  const s = plane.shapes.get(id);
  if (s) return s.bounds;
  const e = plane.edges.get(id);
  return e ? flowAnchor(e) : undefined;
}

/** Middle of the longest segment of a connection (where an association docks on a flow). */
function flowAnchor(e: DEdge): Box | undefined {
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

/**
 * What a route should not run over: the other connections (polylines) and
 * every label as one diagonal (crossing it costs like crossing a flow, so the
 * router keeps off labels when that is cheap).
 */
export function routingLines(plane: Plane, except?: string): Point[][] {
  const out: Point[][] = [];
  for (const e of plane.edges.values()) {
    if (e.id === except) continue;
    if (e.points.length >= 2) out.push(e.points);
    if (e.label) out.push(diagonal(e.label));
  }
  for (const s of plane.shapes.values()) if (s.label) out.push(diagonal(s.label));
  return out;
}

function diagonal(b: Box): Point[] {
  return [
    { x: b.x, y: b.y },
    { x: b.x + b.width, y: b.y + b.height },
  ];
}

/** New waypoints for one connection (see module contract). */
export function routeEdge(plane: Plane, e: DEdge, opts: RouteOptions): Point[] | undefined {
  const s = e.sourceId ? plane.shapes.get(e.sourceId) : undefined;
  const t = e.targetId ? plane.shapes.get(e.targetId) : undefined;
  if (e.kind === 'association' || e.kind === 'dataAssociation' || e.kind === 'other') {
    const sb = anchorOf(plane, e.sourceId);
    const tb = anchorOf(plane, e.targetId);
    if (!sb || !tb) return undefined;
    const line = straight(sb, tb);
    if (!s || !t) return line;
    const obstacles = obstaclesFor(plane, e, s, t);
    if (!obstacles.some((o) => pathHits(line, o))) return line;
    return roundPoints(routeOrthogonal({ source: s.bounds, target: t.bounds, obstacles, lines: opts.lines }));
  }
  if (!s || !t) return undefined;
  const obstacles = obstaclesFor(plane, e, s, t);
  const message = e.kind === 'messageFlow';
  const frame = message ? undefined : commonFrame(plane, s, t);
  const sourceSides = opts.sourceSides ?? (message ? messageSides(s.bounds, t.bounds) : sidesFor(plane, s, 'source'));
  const targetSides = opts.targetSides ?? (message ? messageSides(t.bounds, s.bounds) : sidesFor(plane, t, 'target'));
  // a gateway docks on its vertices, one connection per vertex while a vertex is free
  const gateway = (g: DShape, given: Side[] | undefined): { middle: boolean; avoid?: Side[] } =>
    g.kind !== 'gateway' ? { middle: false } : { middle: true, ...(given || message ? {} : { avoid: [...usedSides(plane, e, g, opts.lines)] }) };
  const sg = gateway(s, opts.sourceSides);
  const tg = gateway(t, opts.targetSides);
  const pts = routeOrthogonal({
    source: s.bounds,
    target: t.bounds,
    sourceSides,
    targetSides,
    obstacles,
    lines: opts.lines,
    sourceMiddle: sg.middle,
    targetMiddle: tg.middle,
    ...(sg.avoid ? { sourceAvoid: sg.avoid } : {}),
    ...(tg.avoid ? { targetAvoid: tg.avoid } : {}),
    ...(frame ? { frame } : {}),
  });
  return roundPoints(pts);
}

/**
 * Shapes a path cuts: leaf shapes, expanded sub-processes that hold neither
 * end and, for a message flow, pools other than the ends' (the ends, their
 * hosts / boundary events and the frames around them excluded).
 */
export function cutShapes(plane: Plane, e: DEdge, points: readonly Point[]): Set<string> {
  const ends = new Set([e.sourceId, e.targetId]);
  const s = e.sourceId ? plane.shapes.get(e.sourceId) : undefined;
  const t = e.targetId ? plane.shapes.get(e.targetId) : undefined;
  const around = new Set([...(s ? ancestors(plane, s) : []), ...(t ? ancestors(plane, t) : [])]);
  // a boundary event's frames are its host's
  for (const end of [s, t]) {
    const host = end?.hostId ? plane.shapes.get(end.hostId) : undefined;
    if (host) for (const id of [host.id, ...ancestors(plane, host)]) around.add(id);
  }
  const out = new Set<string>();
  for (const o of plane.shapes.values()) {
    if (ends.has(o.id) || around.has(o.id)) continue;
    if (o.hostId && ends.has(o.hostId)) continue;
    const solid = isLeaf(o) || (o.kind === 'subProcess' && o.container) || (e.kind === 'messageFlow' && o.kind === 'participant');
    if (solid && pathHits(points, o.bounds)) out.add(o.id);
  }
  return out;
}

export interface EdgeBefore {
  points: Point[];
  /** leaf shapes the connection already cut */
  cut: Set<string>;
  /** distance of the first / last waypoint from its shape's border */
  sourceGap: number;
  targetGap: number;
}

/** Distance of a connection's ends from their shapes' borders (round shapes dock inside their box). */
function endGaps(plane: Plane, e: DEdge): { sourceGap: number; targetGap: number } {
  const gapOf = (id: string | undefined, p: Point | undefined): number => {
    const s = id ? plane.shapes.get(id) : undefined;
    if (!s || !p) return 0;
    const d = borderDistance(s.bounds, p);
    const round = s.kind === 'event' || s.kind === 'boundary' || s.kind === 'gateway';
    return round ? Math.max(0, d - s.bounds.width / 2 + 1) : d;
  };
  return { sourceGap: gapOf(e.sourceId, e.points[0]), targetGap: gapOf(e.targetId, e.points[e.points.length - 1]) };
}

/** The state of a connection before anything moved (for brokenEdge). */
export function edgeBefore(plane: Plane, e: DEdge): EdgeBefore {
  return { points: e.points.map((p) => ({ ...p })), cut: cutShapes(plane, e, e.points), ...endGaps(plane, e) };
}

/** Whether a kept connection has to be rerouted (see module contract). */
export function brokenEdge(plane: Plane, e: DEdge, before: EdgeBefore | undefined): boolean {
  // fewer than two distinct waypoints (both ends pushed onto one point): no line at all
  if (degenerate(e.points)) return true;
  const tol = 3;
  const now = endGaps(plane, e);
  if (now.sourceGap > Math.max(tol, (before?.sourceGap ?? 0) + 1)) return true;
  if (now.targetGap > Math.max(tol, (before?.targetGap ?? 0) + 1)) return true;
  const flow = e.kind === 'sequenceFlow' || e.kind === 'messageFlow';
  if (flow && !isOrthogonal(e.points) && (!before || isOrthogonal(before.points))) return true;
  const cut = cutShapes(plane, e, e.points);
  for (const id of cut) if (!before?.cut.has(id)) return true;
  return false;
}
