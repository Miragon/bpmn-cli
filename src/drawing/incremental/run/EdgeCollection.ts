import type { BpmnElement } from '../../../model/index.js';
import type { DrawingSnapshot } from '../../DrawingSnapshot.js';
import type { DEdge } from '../../plane/DEdge.js';
import type { Plane } from '../../plane/Plane.js';
import { PlaneReader } from '../../plane/PlaneReader.js';
import type { EdgeBefore, EdgeRouter } from '../routing/EdgeRouter.js';
import type { LayoutRun } from './LayoutRun.js';
import { ModelOrder } from './ModelOrder.js';

interface PlaneCheck {
  routes: EdgeRouter;
  detached: boolean;
}

export class EdgeCollection {
  private static readonly CONNECTIONS = ['bpmn:SequenceFlow', 'bpmn:MessageFlow', 'bpmn:Association', 'bpmn:DataAssociation'];

  constructor(
    private readonly run: LayoutRun,
    private readonly before: DrawingSnapshot,
    private readonly edgesBefore: ReadonlyMap<DEdge, EdgeBefore>,
  ) {}

  collect(): void {
    this.adoptConnections();
    for (const plane of this.run.planes) {
      const check = { routes: this.run.drawing(plane).routes, detached: !plane.verticalBand() };
      for (const edge of plane.edges.values()) {
        if (!this.run.fromEngine.has(edge.id) && this.needsRoute(check, edge)) {
          this.run.reroute.add(edge.id);
        }
      }
    }
  }

  private adoptConnections(): void {
    const homes = new Map(this.run.planes.flatMap((plane) => [...plane.edges.values()].map((edge) => [edge.id, { plane, edge }] as const)));
    for (const element of new ModelOrder(this.run.document.tree.definitions).elements()) {
      const id = element.peek<string>('id');
      if (id && EdgeCollection.CONNECTIONS.some((type) => element.is(type))) {
        this.adoptConnection(element, id, homes.get(id));
      }
    }
  }

  private adoptConnection(element: BpmnElement, id: string, drawn: { plane: Plane; edge: DEdge } | undefined): void {
    const home = this.homeOf(element, id);
    if (!home) {
      return;
    }
    if (drawn && drawn.plane !== home) {
      drawn.plane.edges.delete(id);
      home.edges.set(id, drawn.edge);
      this.run.reroute.add(id);
    } else if (!drawn) {
      home.edges.set(id, PlaneReader.edgeOf(element, id));
      this.run.newEdges.add(id);
    }
  }

  private homeOf(element: BpmnElement, id: string): Plane | undefined {
    if (element.is('bpmn:MessageFlow')) {
      return this.run.semantics.homePlane(this.run.planes, id);
    }
    const { sourceId, targetId } = PlaneReader.edgeEnds(element);
    const holds = (plane: Plane, end: string | undefined): boolean => !end || plane.shapes.has(end) || plane.edges.has(end);
    return this.run.planes.find((plane) => holds(plane, sourceId) && holds(plane, targetId));
  }

  private needsRoute(check: PlaneCheck, edge: DEdge): boolean {
    const routedNow = this.run.routedNow.get(edge.id);
    if (routedNow) {
      return !this.heldSince(check, edge, routedNow);
    }
    if (this.run.newEdges.has(edge.id)) {
      return true;
    }
    const old = edge.di ? this.before.byDi.get(edge.di) : undefined;
    const ends = PlaneReader.edgeEnds(edge.el);
    edge.sourceId = ends.sourceId;
    edge.targetId = ends.targetId;
    const { placed } = this.run.place;
    const endsChanged = !!old && (this.run.cur(old.sourceId) !== ends.sourceId || this.run.cur(old.targetId) !== ends.targetId);
    const endPlaced = (!!edge.sourceId && placed.has(edge.sourceId)) || (!!edge.targetId && placed.has(edge.targetId));
    return endsChanged || endPlaced || this.brokeOrTouches(check, edge, this.edgesBefore.get(edge));
  }

  private heldSince(check: PlaneCheck, edge: DEdge, routedNow: EdgeBefore): boolean {
    const { sourceId, targetId } = PlaneReader.edgeEnds(edge.el);
    return sourceId === edge.sourceId && targetId === edge.targetId && edge.points.length >= 2 && !this.brokeOrTouches(check, edge, routedNow);
  }

  private brokeOrTouches({ routes, detached }: PlaneCheck, edge: DEdge, was: EdgeBefore | undefined): boolean {
    return routes.brokenEdge(edge, was, { detached }) || routes.grazes(edge, this.run.place.continued) || routes.touchesFresh(edge);
  }
}
