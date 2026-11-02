import type { BpmnElement, Point } from '../../../model/index.js';
import type { PlaneEdge } from '../../plane/PlaneEdge.js';
import { PlaneShape } from '../../plane/PlaneShape.js';
import type { Plane } from '../../plane/Plane.js';
import { PlaneReader } from '../../plane/PlaneReader.js';
import type { Drawing } from '../Drawing.js';
import type { EdgeBefore } from '../routing/EdgeRouter.js';
import type { LayoutRun } from './LayoutRun.js';

export class IncrementalRouting {
  constructor(
    private readonly run: LayoutRun,
    private readonly edgesBefore: ReadonlyMap<PlaneEdge, EdgeBefore>,
  ) {}

  routeNow(plane: Plane, id: string): void {
    const shape = plane.shapes.get(id);
    const element = this.run.semantics.byId.get(id);
    if (!shape || !element) {
      return;
    }
    for (const flow of [...element.list('incoming'), ...element.list('outgoing')]) {
      this.routeFlowOf(plane, id, flow);
    }
    const drawing = this.run.drawing(plane);
    const detached = !plane.verticalBand();
    for (const edge of plane.edges.values()) {
      if (this.isDrawnElsewhere(plane, id, edge) && this.brokeWhenPlaced(drawing, id, edge, detached)) {
        this.routeKept(plane, edge);
      }
    }
    if (!shape.label && PlaneShape.hasExternalLabel(shape.kind) && element.peek<string>('name')) {
      drawing.labels.placeShapeLabel(shape);
    }
    this.run.place.spacing.delete(plane);
  }

  routeGrazed(): string[] {
    return this.run.planes.flatMap((plane) => {
      const drawing = this.run.drawing(plane);
      const touched = [...plane.edges.values()].filter((edge) => !this.run.newEdges.has(edge.id) && drawing.routes.touchesFresh(edge));
      const routed = touched.filter((edge) => {
        const { points, label } = edge;
        if (!drawing.reroute(edge)) {
          return false;
        }
        if (!drawing.routes.touchesFresh(edge)) {
          return true;
        }
        edge.points = points;
        edge.label = label;
        return false;
      });
      drawing.clearLabels(touched);
      return routed.map((edge) => edge.id);
    });
  }

  routeAll(): string[] {
    return this.run.planes.flatMap((plane) => this.routePlane(plane));
  }

  private routePlane(plane: Plane): string[] {
    const rerouted: string[] = [];
    const drawing = this.run.drawing(plane);
    const pending = drawing.routeOrder([...plane.edges.values()].filter((edge) => this.run.reroute.has(edge.id)));
    const waiting = new Set(pending.map((edge) => edge.id));
    for (const edge of pending) {
      const waitingLines = new Set<Point[] | undefined>([...waiting].map((id) => plane.edges.get(id)?.points));
      const lines = drawing.routes.routingLines(edge.id).filter((line) => !waitingLines.has(line));
      const routed = drawing.reroute(edge, { lines });
      waiting.delete(edge.id);
      if (routed && !this.run.newEdges.has(edge.id)) {
        rerouted.push(edge.id);
      } else if (!routed && !edge.points.length) {
        plane.edges.delete(edge.id);
        this.run.newEdges.delete(edge.id);
        this.run.notes.push(`${edge.id} not drawn: an end has no shape on its diagram`);
      }
    }
    return rerouted;
  }

  private routeFlowOf(plane: Plane, id: string, flow: BpmnElement): void {
    const flowId = flow.peek<string>('id');
    if (!flowId || !flow.is('bpmn:SequenceFlow')) {
      return;
    }
    const { sourceId, targetId } = PlaneReader.edgeEnds(flow);
    const other = sourceId === id ? targetId : sourceId;
    if (!other || !plane.shapes.has(other) || this.run.planes.some((otherPlane) => otherPlane !== plane && otherPlane.edges.has(flowId))) {
      return;
    }
    let edge = plane.edges.get(flowId);
    if (edge) {
      edge.sourceId = sourceId;
      edge.targetId = targetId;
    } else {
      edge = PlaneReader.edgeOf(flow, flowId);
      plane.edges.set(flowId, edge);
      this.run.newEdges.add(flowId);
    }
    this.routeKept(plane, edge);
  }

  private isDrawnElsewhere(plane: Plane, id: string, edge: PlaneEdge): boolean {
    const { sourceId, targetId } = edge;
    if (edge.kind === 'messageFlow' || edge.points.length < 2 || sourceId === id || targetId === id || !sourceId || !targetId) {
      return false;
    }
    const ends = PlaneReader.edgeEnds(edge.el);
    return ends.sourceId === sourceId && ends.targetId === targetId && plane.shapes.has(sourceId) && plane.shapes.has(targetId);
  }

  private brokeWhenPlaced({ routes }: Drawing, id: string, edge: PlaneEdge, detached: boolean): boolean {
    const was = this.run.routedNow.get(edge.id) ?? this.edgesBefore.get(edge);
    return !!was && (routes.brokenEdge(edge, was, { detached }) || (this.run.place.continued.has(id) && routes.grazes(edge, [id])) || routes.touchesFresh(edge));
  }

  private routeKept(plane: Plane, edge: PlaneEdge): void {
    const drawing = this.run.drawing(plane);
    if (drawing.reroute(edge)) {
      this.run.routedNow.set(edge.id, drawing.routes.edgeBefore(edge));
    }
  }
}
