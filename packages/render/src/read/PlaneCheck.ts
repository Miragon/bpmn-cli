import type { BpmnNode } from './BpmnNode.js';
import type { Box } from './Box.js';
import type { Plane, PlaneEdge, PlaneShape } from './DiagramReader.js';
import { Semantics } from './Semantics.js';

export interface SanePlane {
  plane: Plane;
  broken: string[];
  labels: string[];
}

export class PlaneCheck {
  private static readonly COORDINATE_LIMIT = 1_000_000;
  private static readonly DRAWABLE_TYPES = ['bpmn:FlowNode', 'bpmn:SequenceFlow', 'bpmn:MessageFlow', 'bpmn:Lane', 'bpmn:Participant', 'bpmn:DataObjectReference', 'bpmn:DataStoreReference', 'bpmn:TextAnnotation'];

  constructor(
    private readonly semantics: Semantics,
    private readonly planes: Plane[],
  ) {}

  sane(plane: Plane): SanePlane {
    const broken: string[] = [];
    const labels: string[] = [];
    const shapes = PlaneCheck.saneOf(plane.shapes, (shape) => PlaneCheck.saneBox(shape.bounds), broken, labels);
    const edges = PlaneCheck.saneOf(plane.edges, (edge) => edge.points.every((point) => PlaneCheck.saneNumber(point.x) && PlaneCheck.saneNumber(point.y)), broken, labels);
    return { plane: broken.length || labels.length ? { ...plane, shapes, edges } : plane, broken, labels };
  }

  undrawn(plane: Plane): string[] {
    const undrawn: string[] = [];
    for (const [id, element] of this.semantics.byId) {
      const drawable = PlaneCheck.DRAWABLE_TYPES.some((type) => element.is(type));
      if (drawable && !this.planes.some((other) => PlaneCheck.drawnOn(other, id)) && this.homePlane(id, element) === plane) {
        undrawn.push(id);
      }
    }
    return undrawn;
  }

  private static drawnOn(plane: Plane, id: string): boolean {
    return plane.shapes.has(id) || plane.edges.has(id);
  }

  private static saneNumber(candidate: number): boolean {
    return Number.isFinite(candidate) && Math.abs(candidate) <= PlaneCheck.COORDINATE_LIMIT;
  }

  private static saneBox(box: Box): boolean {
    return [box.x, box.y, box.width, box.height, box.right, box.bottom].every((coordinate) => PlaneCheck.saneNumber(coordinate)) && box.width >= 0 && box.height >= 0;
  }

  private static saneOf<Drawn extends PlaneShape | PlaneEdge>(drawn: Map<string, Drawn>, sane: (item: Drawn) => boolean, broken: string[], labels: string[]): Map<string, Drawn> {
    const kept = new Map<string, Drawn>();
    for (const [id, item] of drawn) {
      if (!sane(item)) {
        broken.push(id);
      } else if (item.label && !PlaneCheck.saneBox(item.label)) {
        labels.push(id);
        kept.set(id, { ...item, label: undefined });
      } else {
        kept.set(id, item);
      }
    }
    return kept;
  }

  private homePlane(id: string, element: BpmnNode): Plane | undefined {
    if (element.is('bpmn:Participant') || element.is('bpmn:MessageFlow')) {
      return this.collaborationPlane();
    }
    if (element.is('bpmn:Lane')) {
      return this.planeOfProcess(this.semantics.laneProcess.get(id));
    }
    return this.planeOfScope(this.semantics.scopeOf.get(id));
  }

  private planeOfScope(scope: BpmnNode | undefined): Plane | undefined {
    const scopeId = scope?.id;
    if (!scope || !scopeId) {
      return undefined;
    }
    if (scope.is('bpmn:Collaboration')) {
      return this.collaborationPlane();
    }
    if (Semantics.isSubProcess(scope)) {
      return this.planes.find((plane) => plane.shapes.get(scopeId)?.expanded) ?? this.planeWithRoot(scopeId);
    }
    return this.planeOfProcess(scopeId);
  }

  private planeOfProcess(processId: string | undefined): Plane | undefined {
    return this.planeWithRoot(processId) ?? (processId && this.semantics.poolOfProcess.has(processId) ? this.collaborationPlane() : undefined);
  }

  private planeWithRoot(rootId: string | undefined): Plane | undefined {
    return this.planes.find((plane) => plane.rootId === rootId);
  }

  private collaborationPlane(): Plane | undefined {
    return this.semantics.collaboration ? this.planeWithRoot(this.semantics.collaboration.id) : undefined;
  }
}
