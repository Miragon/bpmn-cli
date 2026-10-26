import { DrawingCheckpoint } from '../../drawing/DrawingCheckpoint.js';
import { EdgeRouter, type EdgeBefore, type RouteOptions } from './EdgeRouter.js';
import { FrameEditor } from './FrameEditor.js';
import { LabelPlacer } from './LabelPlacer.js';
import { Separation, type SeparateOptions, type SeparateResult } from './Separation.js';
import type { Axis } from './utils/bands.js';
import { SpaceTool, type SpaceRequest, type SpaceResult, type StripRequest } from './SpaceTool.js';
import type { DrawingSnapshot } from './DrawingSnapshot.js';
import type { TrialGuard } from '../../drawing/TrialGuard.js';
import type { Box, DEdge, DShape, Plane, Point, Side } from '../../drawing/types.js';
import type { Semantics } from '../../drawing/Semantics.js';
import { segmentHits } from '../../drawing/utils/geom.js';
import { hasExternalLabel, labelSideOf, type LabelSide } from '../../drawing/utils/labels.js';
import { raw } from '../../drawing/utils/raw.js';

/**
 * One plane of a drawing kept while it is edited: the space tool, single-connection routing and
 * labelling, overlap removal and frame edits behind one seam.
 */
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

  checkpoint(): DrawingCheckpoint {
    return new DrawingCheckpoint(this.plane);
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

  fitInFrame(id: string, pad?: number, frameFn?: (shape: DShape) => DShape | undefined, keepAlso?: Iterable<string>): SpaceResult {
    return this.space.fitInFrame(id, pad, frameFn, keepAlso);
  }

  unitBox(shape: DShape): Box {
    return this.space.unitBox(shape);
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

  route(edge: DEdge, opts: RouteOptions): Point[] | undefined {
    return this.routes.routeEdge(edge, opts);
  }

  routingLines(except?: string): Point[][] {
    return this.routes.routingLines(except);
  }

  routeRank(edge: DEdge): number {
    return this.routes.routeRank(edge);
  }

  routeOrder(edges: Iterable<DEdge>): DEdge[] {
    return [...edges].sort((left, right) => this.routes.routeRank(left) - this.routes.routeRank(right));
  }

  edgeBefore(edge: DEdge): EdgeBefore {
    return this.routes.edgeBefore(edge);
  }

  brokenEdge(edge: DEdge, before: EdgeBefore | undefined, opts?: { detached?: boolean }): boolean {
    return this.routes.brokenEdge(edge, before, opts);
  }

  detachedEnds(edge: DEdge): string[] {
    return this.routes.detachedEnds(edge);
  }

  reroute(edge: DEdge, opts: { lines?: Point[][]; sourceSides?: Side[]; targetSides?: Side[] } = {}): boolean {
    const { lines, ...sides } = opts;
    const pts = this.routes.routeEdge(edge, { lines: lines ?? this.routes.routingLines(edge.id), ...sides });
    if (!pts || pts.length < 2) return false;
    this.adoptRoute(edge, pts);
    return true;
  }

  adoptRoute(edge: DEdge, points: Point[]): void {
    edge.points = points;
    if (edge.label || raw<string>(edge.el, 'name')) this.labels.placeEdgeLabel(edge);
  }

  placeShapeLabel(shape: DShape, prefer?: LabelSide): Box | undefined {
    return this.labels.placeShapeLabel(shape, prefer);
  }

  placeEdgeLabel(edge: DEdge): Box | undefined {
    return this.labels.placeEdgeLabel(edge);
  }

  labelOnSide(shape: DShape, side: LabelSide, size: { width: number; height: number }): Box {
    return this.labels.labelOnSide(shape, side, size);
  }

  refitLabel(owner: DShape | DEdge): Box | undefined {
    return this.labels.refitLabel(owner);
  }

  clearTitles(wasClear: (owner: DShape | DEdge, sub: DShape) => boolean): Array<[string, string]> {
    return this.labels.clearTitles(wasClear);
  }

  clearLabels(fresh: readonly DEdge[]): void {
    const segs = fresh.flatMap((edge) => edge.points.slice(1).map((end, index) => [edge.points[index]!, end] as const));
    if (!segs.length) return;
    for (const shape of this.plane.shapes.values()) {
      if (!shape.label || !hasExternalLabel(shape) || !segs.some(([start, end]) => segmentHits(start, end, shape.label!, 1))) continue;
      const host = shape.hostId ? this.plane.shapes.get(shape.hostId)?.bounds : undefined;
      const side = labelSideOf(shape, host);
      this.labels.placeShapeLabel(shape, side === 'inside' ? undefined : side);
    }
  }

  /**
   * After shapes moved: translates connections whose ends moved alike, reroutes broken ones and
   * re-places labels the move brought onto a title. Returns the rerouted ids.
   */
  settle(before: DrawingSnapshot): string[] {
    const delta = new Map<string, { dx: number; dy: number }>();
    for (const shape of this.plane.shapes.values()) {
      const beforeBox = before.bounds.get(shape.id);
      if (!beforeBox || Math.abs(beforeBox.width - shape.bounds.width) > 0.5 || Math.abs(beforeBox.height - shape.bounds.height) > 0.5) continue;
      const dx = shape.bounds.x - beforeBox.x;
      const dy = shape.bounds.y - beforeBox.y;
      if (dx || dy) delta.set(shape.id, { dx, dy });
    }
    for (const edge of this.plane.edges.values()) {
      if (!before.unchanged(edge)) continue;
      const sourceDelta = edge.sourceId ? delta.get(edge.sourceId) : undefined;
      const targetDelta = edge.targetId ? delta.get(edge.targetId) : undefined;
      if (!sourceDelta || !targetDelta || sourceDelta.dx !== targetDelta.dx || sourceDelta.dy !== targetDelta.dy) continue;
      for (const point of edge.points) {
        point.x += sourceDelta.dx;
        point.y += sourceDelta.dy;
      }
      if (edge.label) {
        edge.label.x += sourceDelta.dx;
        edge.label.y += sourceDelta.dy;
      }
    }
    const rerouted: DEdge[] = [];
    for (const edge of this.routeOrder(this.plane.edges.values())) {
      if (!this.routes.brokenEdge(edge, before.edges.get(edge))) continue;
      if (this.reroute(edge)) rerouted.push(edge);
    }
    this.clearLabels(rerouted);
    this.labels.clearTitles((owner, sub) => before.clearOfTitle(owner, sub));
    return rerouted.map((edge) => edge.id);
  }

  /** Runs a change that must not make the drawing worse: the guard may reject and undo it. */
  attempt(guard: TrialGuard, change: () => SpaceResult | undefined, force: readonly string[] = []): boolean {
    const st = this.checkpoint();
    const before = new Map([...this.plane.edges.values()].map((edge) => [edge, this.routes.edgeBefore(edge)] as const));
    const result = change();
    if (!result || (!result.moved.size && !result.resized.size)) {
      st.restore();
      return false;
    }
    const fresh = this.routeOrder(this.plane.edges.values()).filter((edge) => (force.includes(edge.id) || this.routes.brokenEdge(edge, before.get(edge))) && this.reroute(edge));
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
