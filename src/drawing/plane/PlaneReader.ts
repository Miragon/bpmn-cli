import { DiagramIndex, Point, type Box, type BpmnElement } from '../../model/index.js';
import { DEdge, type EdgeKind } from './DEdge.js';
import { DShape, type ShapeKind } from './DShape.js';
import { Plane } from './Plane.js';
import { Semantics } from './Semantics.js';

export type EdgeEnds = Pick<DEdge, 'sourceId' | 'targetId'>;

export class PlaneReader {
  private static readonly SHAPE_KINDS: ReadonlyArray<[string, ShapeKind]> = [
    ['bpmn:BoundaryEvent', 'boundary'],
    ['bpmn:Event', 'event'],
    ['bpmn:Gateway', 'gateway'],
    ['bpmn:SubProcess', 'subProcess'],
    ['bpmn:Activity', 'task'],
    ['bpmn:DataObjectReference', 'data'],
    ['bpmn:DataStoreReference', 'data'],
    ['bpmn:DataInput', 'data'],
    ['bpmn:DataOutput', 'data'],
    ['bpmn:TextAnnotation', 'annotation'],
    ['bpmn:Participant', 'participant'],
    ['bpmn:Lane', 'lane'],
    ['bpmn:Group', 'group'],
  ];

  private static readonly EDGE_KINDS: ReadonlyArray<[string, EdgeKind]> = [
    ['bpmn:SequenceFlow', 'sequenceFlow'],
    ['bpmn:MessageFlow', 'messageFlow'],
    ['bpmn:Association', 'association'],
    ['bpmn:DataAssociation', 'dataAssociation'],
  ];

  constructor(
    private readonly definitions: BpmnElement,
    readonly semantics: Semantics = Semantics.of(definitions),
  ) {}

  static shapeKind(element: BpmnElement): ShapeKind {
    return PlaneReader.SHAPE_KINDS.find(([type]) => element.is(type))?.[1] ?? 'other';
  }

  static edgeKind(element: BpmnElement): EdgeKind {
    return PlaneReader.EDGE_KINDS.find(([type]) => element.is(type))?.[1] ?? 'other';
  }

  static edgeEnds(element: BpmnElement): EdgeEnds {
    const idOf = (end: BpmnElement | undefined): string | undefined => end?.peek<string>('id');
    if (element.is('bpmn:DataInputAssociation')) {
      return { sourceId: idOf(element.list('sourceRef')[0]), targetId: idOf(element.parent) };
    }
    if (element.is('bpmn:DataOutputAssociation')) {
      return { sourceId: idOf(element.parent), targetId: idOf(element.peek<BpmnElement>('targetRef')) };
    }
    return { sourceId: idOf(element.peek<BpmnElement>('sourceRef')), targetId: idOf(element.peek<BpmnElement>('targetRef')) };
  }

  static shapeOf(semantics: Semantics, id: string, element: BpmnElement, bounds: Box, expanded: boolean | undefined): DShape {
    const kind = PlaneReader.shapeKind(element);
    const shape = new DShape(id, element, bounds, kind, kind === 'participant' || kind === 'lane' || (kind === 'subProcess' && expanded === true));
    shape.expanded = expanded;
    if (kind === 'boundary') {
      shape.hostId = element.peek<BpmnElement>('attachedToRef')?.peek<string>('id');
    }
    shape.laneId = kind === 'lane' ? semantics.laneParent.get(id) : semantics.laneOf.get(id);
    shape.poolId = semantics.poolOf(id);
    return shape;
  }

  static edgeOf(element: BpmnElement, id: string, points: Point[] = []): DEdge {
    const edge = new DEdge(id, element, PlaneReader.edgeKind(element), points);
    const { sourceId, targetId } = PlaneReader.edgeEnds(element);
    edge.sourceId = sourceId;
    edge.targetId = targetId;
    return edge;
  }

  private static labelBoxOf(di: BpmnElement): Box | undefined {
    return DiagramIndex.boxOf(di.peek<BpmnElement>('label')?.peek<BpmnElement>('bounds'));
  }

  planes(): Plane[] {
    return this.definitions.list('diagrams').flatMap((diagram) => this.plane(diagram) ?? []);
  }

  plane(diagram: BpmnElement): Plane | undefined {
    const di = diagram.peek<BpmnElement>('plane');
    const root = di?.peek<BpmnElement>('bpmnElement') ?? (di ? DiagramIndex.displayRoot(diagram.parent) : undefined);
    const rootId = root?.peek<string>('id');
    if (!di || !root || !rootId) {
      return undefined;
    }
    const plane = new Plane(di.peek<string>('id') ?? `BPMNPlane_${rootId}`, rootId, root, di);
    for (const planeElement of di.list('planeElement')) {
      this.readInto(plane, planeElement);
    }
    this.linkParents(plane);
    return plane;
  }

  private readInto(plane: Plane, di: BpmnElement): void {
    const element = di.peek<BpmnElement>('bpmnElement');
    const id = element?.peek<string>('id');
    if (!element || !id) {
      return;
    }
    if (di.is('bpmndi:BPMNShape')) {
      this.readShape(plane, di, element, id);
    } else if (di.is('bpmndi:BPMNEdge')) {
      plane.edges.set(id, this.readEdge(di, element, id));
    }
  }

  private readShape(plane: Plane, di: BpmnElement, element: BpmnElement, id: string): void {
    const bounds = DiagramIndex.boxOf(di.peek<BpmnElement>('bounds'));
    if (!bounds) {
      plane.unbounded ??= new Map();
      plane.unbounded.set(id, di);
      return;
    }
    const expanded = DiagramIndex.isSubProcess(element) ? di.peek<boolean>('isExpanded') === true : undefined;
    const shape = PlaneReader.shapeOf(this.semantics, id, element, bounds, expanded);
    shape.di = di;
    shape.label = PlaneReader.labelBoxOf(di);
    plane.shapes.set(id, shape);
  }

  private readEdge(di: BpmnElement, element: BpmnElement, id: string): DEdge {
    const points = di.list('waypoint').map((waypoint) => new Point(waypoint.peek<number>('x') ?? 0, waypoint.peek<number>('y') ?? 0));
    const edge = PlaneReader.edgeOf(element, id, points);
    edge.di = di;
    edge.label = PlaneReader.labelBoxOf(di);
    return edge;
  }

  private linkParents(plane: Plane): void {
    for (const shape of plane.shapes.values()) {
      const scope = this.semantics.scopeOf.get(shape.id);
      const scopeId = scope?.peek<string>('id');
      if (scopeId && DiagramIndex.isSubProcess(scope) && plane.shapes.get(scopeId)?.expanded) {
        shape.parentId = scopeId;
      }
    }
  }
}
