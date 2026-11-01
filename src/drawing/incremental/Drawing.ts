import { Polyline, type Point } from '../../model/index.js';
import { DrawingCheckpoint } from '../plane/DrawingCheckpoint.js';
import type { DEdge } from '../plane/DEdge.js';
import { DShape } from '../plane/DShape.js';
import type { Plane } from '../plane/Plane.js';
import type { Side } from '../plane/ShapeSides.js';
import type { TrialGuard } from '../plane/TrialGuard.js';
import { FrameEditor } from './frames/FrameEditor.js';
import { Separation } from './frames/Separation.js';
import { LabelPlacer } from './labels/LabelPlacer.js';
import type { OperationBefore } from './OperationBefore.js';
import { EdgeRouter } from './routing/EdgeRouter.js';
import { SpaceTool, type SpaceResult } from './space/SpaceTool.js';

interface Translation {
  dx: number;
  dy: number;
}

export class Drawing {
  readonly space: SpaceTool;
  readonly routes: EdgeRouter;
  readonly labels: LabelPlacer;
  readonly separation: Separation;
  readonly frames: FrameEditor;

  constructor(
    readonly plane: Plane,
    readonly touched: Set<string> = new Set(),
    fresh?: ReadonlySet<string>,
  ) {
    this.space = new SpaceTool(plane);
    this.routes = new EdgeRouter(plane, fresh);
    this.labels = new LabelPlacer(plane);
    this.separation = new Separation(plane, this.space);
    this.frames = new FrameEditor(plane, this.space, touched);
  }

  checkpoint(): DrawingCheckpoint {
    return new DrawingCheckpoint(this.plane);
  }

  routeOrder(edges: Iterable<DEdge>): DEdge[] {
    return [...edges].sort((left, right) => this.routes.routeRank(left) - this.routes.routeRank(right));
  }

  reroute(edge: DEdge, opts: { lines?: Point[][]; sourceSides?: Side[]; targetSides?: Side[] } = {}): boolean {
    const { lines, ...sides } = opts;
    const points = this.routes.routeEdge(edge, { lines: lines ?? this.routes.routingLines(edge.id), ...sides });
    if (!points || points.length < 2) {
      return false;
    }
    this.adoptRoute(edge, points);
    return true;
  }

  adoptRoute(edge: DEdge, points: Point[]): void {
    edge.points = points;
    if (edge.label || edge.el.peek<string>('name')) {
      this.labels.placeEdgeLabel(edge);
    }
  }

  clearLabels(fresh: readonly DEdge[]): void {
    for (const shape of this.plane.shapes.values()) {
      const { label } = shape;
      if (!label || !DShape.hasExternalLabel(shape.kind) || !fresh.some((edge) => new Polyline(edge.points).hits(label, 1))) {
        continue;
      }
      const host = shape.hostId ? this.plane.shapes.get(shape.hostId)?.bounds : undefined;
      const side = shape.labelSide(host);
      this.labels.placeShapeLabel(shape, side === 'inside' ? undefined : side);
    }
  }

  settle(before: OperationBefore): string[] {
    this.translateRigidEdges(before);
    const rerouted: DEdge[] = [];
    for (const edge of this.routeOrder(this.plane.edges.values())) {
      if (this.routes.brokenEdge(edge, before.edges.get(edge)) && this.reroute(edge)) {
        rerouted.push(edge);
      }
    }
    this.clearLabels(rerouted);
    this.labels.clearTitles((owner, sub) => before.clearOfTitle(owner, sub));
    return rerouted.map((edge) => edge.id);
  }

  attempt(guard: TrialGuard, change: () => SpaceResult | undefined, force: readonly string[] = []): boolean {
    const checkpoint = this.checkpoint();
    const before = new Map([...this.plane.edges.values()].map((edge) => [edge, this.routes.edgeBefore(edge)] as const));
    const result = change();
    if (!result || (!result.moved.size && !result.resized.size)) {
      checkpoint.restore();
      return false;
    }
    const fresh = this.routeOrder(this.plane.edges.values()).filter((edge) => (force.includes(edge.id) || this.routes.brokenEdge(edge, before.get(edge))) && this.reroute(edge));
    this.clearLabels(fresh);
    if (guard.judge().ok) {
      return true;
    }
    checkpoint.restore();
    return false;
  }

  private translateRigidEdges(before: OperationBefore): void {
    const translations = this.translationsSince(before);
    for (const edge of this.plane.edges.values()) {
      const source = edge.sourceId ? translations.get(edge.sourceId) : undefined;
      const target = edge.targetId ? translations.get(edge.targetId) : undefined;
      if (before.unchanged(edge) && source && target && source.dx === target.dx && source.dy === target.dy) {
        edge.translate(source.dx, source.dy);
      }
    }
  }

  private translationsSince(before: OperationBefore): Map<string, Translation> {
    const translations = new Map<string, Translation>();
    for (const shape of this.plane.shapes.values()) {
      const box = before.bounds.get(shape.id);
      if (!box || Math.abs(box.width - shape.bounds.width) > 0.5 || Math.abs(box.height - shape.bounds.height) > 0.5) {
        continue;
      }
      const dx = shape.bounds.x - box.x;
      const dy = shape.bounds.y - box.y;
      if (dx || dy) {
        translations.set(shape.id, { dx, dy });
      }
    }
    return translations;
  }
}
