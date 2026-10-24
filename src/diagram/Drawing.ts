/**
 * One plane of a drawing that is kept while it is edited (the incremental
 * layout, the format ops): the space tool, the routing and labelling of
 * single connections, the overlap removal and the frames, behind one seam.
 * What the frame edits move or resize goes into `touched`.
 *
 * CONTRACT
 *  - reroute(edge, {lines?, sourceSides?, targetSides?}) routes one
 *    connection again (EdgeRouter.routeEdge, against routingLines without
 *    the edge itself unless `lines` is given) and places its label when it
 *    has one or a name (LabelPlacer.placeEdgeLabel); false, with nothing
 *    changed, when an end has no shape. adoptRoute(edge, points) does the
 *    second half for points routed before.
 *  - routeOrder(edges): the edges in routeRank order (stable).
 *  - clearLabels(fresh): every shape label one of the `fresh` lines runs
 *    over is placed again, on the side it was on.
 *  - settle(before) after shapes moved on the plane: connections whose two
 *    ends moved by the same offset are translated, connections now broken
 *    (brokenEdge against `before`) are routed again in routeOrder,
 *    clearLabels for them, and a label the move brought onto the title of
 *    an expanded sub-process that it was clear of before is placed again
 *    (clearTitles; DrawingSnapshot.clearOfTitle). Returns the rerouted ids.
 *  - attempt(guard, change, force?) runs one change that must not make the
 *    drawing worse: nothing changed (no result, nothing moved or resized):
 *    undone, false. Else the connections it broke (and `force`) are routed
 *    again in routeOrder, clearLabels for them, and the guard judges the
 *    drawing (TrialGuard): rejected, everything is undone (checkpoint).
 *  - checkpoint(): a PlaneCheckpoint of the plane.
 */
import { PlaneCheckpoint } from './PlaneCheckpoint.js';
import { EdgeRouter, type EdgeBefore, type RouteOptions } from './EdgeRouter.js';
import { FrameEditor } from './FrameEditor.js';
import { LabelPlacer } from './LabelPlacer.js';
import { Separation, type SeparateOptions, type SeparateResult } from './Separation.js';
import { SpaceTool, type Axis, type SpaceRequest, type SpaceResult, type StripRequest } from './SpaceTool.js';
import type { DrawingSnapshot } from './DrawingSnapshot.js';
import type { TrialGuard } from './TrialGuard.js';
import type { Box, DEdge, DShape, Plane, Point, Side } from './types.js';
import type { Semantics } from './Semantics.js';
import { segmentHits } from './utils/geom.js';
import { hasExternalLabel, labelSideOf, type LabelSide } from './utils/labels.js';
import { raw } from './utils/plane.js';

export class Drawing {
  private readonly space: SpaceTool;
  private readonly routes: EdgeRouter;
  private readonly labels: LabelPlacer;
  private readonly separation: Separation;
  private readonly frames: FrameEditor;

  constructor(
    readonly plane: Plane,
    readonly touched: Set<string> = new Set(),
  ) {
    this.space = new SpaceTool(plane);
    this.routes = new EdgeRouter(plane);
    this.labels = new LabelPlacer(plane);
    this.separation = new Separation(plane, this.space);
    this.frames = new FrameEditor(plane, this.space, touched);
  }

  checkpoint(): PlaneCheckpoint {
    return new PlaneCheckpoint(this.plane);
  }

  shift(id: string, dx: number, dy: number): string[] {
    return this.space.shiftShape(id, dx, dy);
  }

  makeSpace(req: SpaceRequest): SpaceResult {
    return this.space.makeSpace(req);
  }

  closeStrip(req: StripRequest): SpaceResult | undefined {
    return this.space.closeStrip(req);
  }

  fitInFrame(id: string, pad?: number, frameFn?: (s: DShape) => DShape | undefined, keepAlso?: Iterable<string>): SpaceResult {
    return this.space.fitInFrame(id, pad, frameFn, keepAlso);
  }

  unitBox(s: DShape): Box {
    return this.space.unitBox(s);
  }

  borderPad(frame: DShape, box: Box, axis: Axis): number {
    return this.space.borderPad(frame, box, axis);
  }

  roomBelowTitle(sub: DShape, label: Box, anchor: string): { delta: number; res: SpaceResult } | undefined {
    return this.space.roomBelowTitle(sub, label, anchor);
  }

  separate(opts: SeparateOptions): SeparateResult {
    return this.separation.separate(opts);
  }

  tidy(opts?: { ids?: Iterable<string>; gap?: number }): { moved: string[]; resized: string[]; unresolved: Array<[string, string]> } {
    return this.separation.tidy(opts);
  }

  route(e: DEdge, opts: RouteOptions): Point[] | undefined {
    return this.routes.routeEdge(e, opts);
  }

  routingLines(except?: string): Point[][] {
    return this.routes.routingLines(except);
  }

  routeRank(e: DEdge): number {
    return this.routes.routeRank(e);
  }

  routeOrder(edges: Iterable<DEdge>): DEdge[] {
    return [...edges].sort((p, q) => this.routes.routeRank(p) - this.routes.routeRank(q));
  }

  edgeBefore(e: DEdge): EdgeBefore {
    return this.routes.edgeBefore(e);
  }

  brokenEdge(e: DEdge, before: EdgeBefore | undefined, opts?: { detached?: boolean }): boolean {
    return this.routes.brokenEdge(e, before, opts);
  }

  detachedEnds(e: DEdge): string[] {
    return this.routes.detachedEnds(e);
  }

  reroute(e: DEdge, opts: { lines?: Point[][]; sourceSides?: Side[]; targetSides?: Side[] } = {}): boolean {
    const { lines, ...sides } = opts;
    const pts = this.routes.routeEdge(e, { lines: lines ?? this.routes.routingLines(e.id), ...sides });
    if (!pts || pts.length < 2) return false;
    this.adoptRoute(e, pts);
    return true;
  }

  adoptRoute(e: DEdge, points: Point[]): void {
    e.points = points;
    if (e.label || raw<string>(e.el, 'name')) this.labels.placeEdgeLabel(e);
  }

  placeShapeLabel(s: DShape, prefer?: LabelSide): Box | undefined {
    return this.labels.placeShapeLabel(s, prefer);
  }

  placeEdgeLabel(e: DEdge): Box | undefined {
    return this.labels.placeEdgeLabel(e);
  }

  labelOnSide(s: DShape, side: LabelSide, size: { width: number; height: number }): Box {
    return this.labels.labelOnSide(s, side, size);
  }

  refitLabel(owner: DShape | DEdge): Box | undefined {
    return this.labels.refitLabel(owner);
  }

  clearTitles(wasClear: (owner: DShape | DEdge, sub: DShape) => boolean): Array<[string, string]> {
    return this.labels.clearTitles(wasClear);
  }

  clearLabels(fresh: readonly DEdge[]): void {
    const segs = fresh.flatMap((e) => e.points.slice(1).map((q, i) => [e.points[i]!, q] as const));
    if (!segs.length) return;
    for (const s of this.plane.shapes.values()) {
      if (!s.label || !hasExternalLabel(s) || !segs.some(([p, q]) => segmentHits(p, q, s.label!, 1))) continue;
      const host = s.hostId ? this.plane.shapes.get(s.hostId)?.bounds : undefined;
      const side = labelSideOf(s, host);
      this.labels.placeShapeLabel(s, side === 'inside' ? undefined : side);
    }
  }

  settle(before: DrawingSnapshot): string[] {
    const delta = new Map<string, { dx: number; dy: number }>();
    for (const s of this.plane.shapes.values()) {
      const b = before.bounds.get(s.id);
      if (!b || Math.abs(b.width - s.bounds.width) > 0.5 || Math.abs(b.height - s.bounds.height) > 0.5) continue;
      const dx = s.bounds.x - b.x;
      const dy = s.bounds.y - b.y;
      if (dx || dy) delta.set(s.id, { dx, dy });
    }
    for (const e of this.plane.edges.values()) {
      if (!before.unchanged(e)) continue;
      const a = e.sourceId ? delta.get(e.sourceId) : undefined;
      const b = e.targetId ? delta.get(e.targetId) : undefined;
      if (!a || !b || a.dx !== b.dx || a.dy !== b.dy) continue;
      for (const p of e.points) {
        p.x += a.dx;
        p.y += a.dy;
      }
      if (e.label) {
        e.label.x += a.dx;
        e.label.y += a.dy;
      }
    }
    const rerouted: DEdge[] = [];
    for (const e of this.routeOrder(this.plane.edges.values())) {
      if (!this.routes.brokenEdge(e, before.edges.get(e))) continue;
      if (this.reroute(e)) rerouted.push(e);
    }
    this.clearLabels(rerouted);
    this.labels.clearTitles((owner, sub) => before.clearOfTitle(owner, sub));
    return rerouted.map((e) => e.id);
  }

  attempt(guard: TrialGuard, change: () => SpaceResult | undefined, force: readonly string[] = []): boolean {
    const st = this.checkpoint();
    const before = new Map([...this.plane.edges.values()].map((e) => [e, this.routes.edgeBefore(e)] as const));
    const r = change();
    if (!r || (!r.moved.size && !r.resized.size)) {
      st.restore();
      return false;
    }
    const fresh = this.routeOrder(this.plane.edges.values()).filter((e) => (force.includes(e.id) || this.routes.brokenEdge(e, before.get(e))) && this.reroute(e));
    this.clearLabels(fresh);
    if (guard.judge().ok) return true;
    st.restore();
    return false;
  }

  wrapPool(pool: DShape): void {
    this.frames.wrapPool(pool);
  }

  placePool(pool: DShape, blackBox: boolean, size?: { width: number; height: number }): void {
    this.frames.placePool(pool, blackBox, size);
  }

  placeLane(lane: DShape): boolean {
    return this.frames.placeLane(lane);
  }

  removedLane(box: Box, poolId: string | undefined, parentId: string | undefined): void {
    this.frames.removedLane(box, poolId, parentId);
  }

  removedPool(box: Box): void {
    this.frames.removedPool(box);
  }

  reseatBoundaries(host: DShape, old: Box): void {
    this.frames.reseatBoundaries(host, old);
  }

  collapse(sub: DShape, child: Plane, gap: number): void {
    this.frames.collapse(sub, child, gap);
  }

  expand(sub: DShape, child: Plane | undefined, sem: Semantics): void {
    this.frames.expand(sub, child, sem);
  }
}
