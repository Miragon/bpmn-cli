import * as bpmnModdle from 'bpmn-moddle';
import { BpmnNode } from './BpmnNode.js';
import { Box, type Point } from './Box.js';
import { RenderError } from './RenderError.js';
import { Semantics } from './Semantics.js';

export type ShapeKind = 'task' | 'subProcess' | 'event' | 'gateway' | 'boundary' | 'data' | 'annotation' | 'participant' | 'lane' | 'group' | 'other';
export type EdgeKind = 'sequenceFlow' | 'messageFlow' | 'association' | 'dataAssociation' | 'other';

export interface PlaneShape {
  id: string;
  element: BpmnNode;
  di: BpmnNode;
  bounds: Box;
  kind: ShapeKind;
  container: boolean;
  expanded: boolean | undefined;
  label: Box | undefined;
  hostId: string | undefined;
  laneId: string | undefined;
  parentId?: string;
}

export interface PlaneEdge {
  id: string;
  element: BpmnNode;
  di: BpmnNode;
  kind: EdgeKind;
  sourceId: string | undefined;
  targetId: string | undefined;
  points: Point[];
  label: Box | undefined;
}

export interface Plane {
  rootId: string;
  shapes: Map<string, PlaneShape>;
  edges: Map<string, PlaneEdge>;
}

interface ModdleParser {
  fromXML(xml: string): Promise<{ rootElement: unknown }>;
}

export class DiagramReader {
  private static readonly Moddle = (bpmnModdle as unknown as { BpmnModdle: new () => ModdleParser }).BpmnModdle;
  private static readonly SHAPE_KINDS: ReadonlyArray<readonly [string, ShapeKind]> = [
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
  private static readonly EDGE_KINDS: ReadonlyArray<readonly [string, EdgeKind]> = [
    ['bpmn:SequenceFlow', 'sequenceFlow'],
    ['bpmn:MessageFlow', 'messageFlow'],
    ['bpmn:Association', 'association'],
    ['bpmn:DataAssociation', 'dataAssociation'],
  ];

  readonly semantics: Semantics;

  constructor(private readonly definitions: BpmnNode) {
    this.semantics = new Semantics(definitions);
  }

  static async fromXml(xml: string): Promise<DiagramReader> {
    const root = BpmnNode.of(await DiagramReader.parsed(xml));
    if (!root?.is('bpmn:Definitions')) {
      throw new RenderError('E_PARSE', 'Root element is not bpmn:Definitions');
    }
    return new DiagramReader(root);
  }

  planes(): Plane[] {
    return this.definitions.list('diagrams').flatMap((diagram) => this.plane(diagram) ?? []);
  }

  private static async parsed(xml: string): Promise<unknown> {
    try {
      return (await new DiagramReader.Moddle().fromXML(xml)).rootElement;
    } catch (cause) {
      throw new RenderError('E_PARSE', `Cannot parse BPMN XML: ${(cause as Error).message.split('\n')[0]}`);
    }
  }

  private static kindOf<Kind extends ShapeKind | EdgeKind>(element: BpmnNode, kinds: ReadonlyArray<readonly [string, Kind]>): Kind | 'other' {
    return kinds.find(([type]) => element.is(type))?.[1] ?? 'other';
  }

  private static edgeEnds(element: BpmnNode): Pick<PlaneEdge, 'sourceId' | 'targetId'> {
    if (element.is('bpmn:DataInputAssociation')) {
      return { sourceId: element.list('sourceRef')[0]?.id, targetId: element.parent?.id };
    }
    if (element.is('bpmn:DataOutputAssociation')) {
      return { sourceId: element.parent?.id, targetId: element.ref('targetRef')?.id };
    }
    return { sourceId: element.ref('sourceRef')?.id, targetId: element.ref('targetRef')?.id };
  }

  private static boxOf(bounds: BpmnNode | undefined): Box | undefined {
    if (!bounds) {
      return undefined;
    }
    const coordinates = [bounds.value('x'), bounds.value('y'), bounds.value('width'), bounds.value('height')];
    if (coordinates.some((coordinate) => typeof coordinate !== 'number' || !Number.isFinite(coordinate))) {
      return undefined;
    }
    const [x, y, width, height] = coordinates as [number, number, number, number];
    return new Box(x, y, width, height);
  }

  private static labelOf(di: BpmnNode): Box | undefined {
    return DiagramReader.boxOf(di.ref('label')?.ref('bounds'));
  }

  private static displayRoot(definitions: BpmnNode | undefined): BpmnNode | undefined {
    return definitions?.list('rootElements').find((root) => root.is('bpmn:Process') || root.is('bpmn:Collaboration'));
  }

  private plane(diagram: BpmnNode): Plane | undefined {
    const di = diagram.ref('plane');
    const rootId = (di?.ref('bpmnElement') ?? (di ? DiagramReader.displayRoot(diagram.parent) : undefined))?.id;
    if (!di || !rootId) {
      return undefined;
    }
    const plane: Plane = { rootId, shapes: new Map(), edges: new Map() };
    for (const element of di.list('planeElement')) {
      this.readInto(plane, element);
    }
    this.linkParents(plane);
    return plane;
  }

  private readInto(plane: Plane, di: BpmnNode): void {
    const element = di.ref('bpmnElement');
    const id = element?.id;
    if (!element || !id) {
      return;
    }
    if (di.is('bpmndi:BPMNShape')) {
      const shape = this.shapeOf(di, element, id);
      if (shape) {
        plane.shapes.set(id, shape);
      }
    } else if (di.is('bpmndi:BPMNEdge')) {
      plane.edges.set(id, this.edgeOf(di, element, id));
    }
  }

  private shapeOf(di: BpmnNode, element: BpmnNode, id: string): PlaneShape | undefined {
    const bounds = DiagramReader.boxOf(di.ref('bounds'));
    if (!bounds) {
      return undefined;
    }
    const kind = DiagramReader.kindOf(element, DiagramReader.SHAPE_KINDS);
    const expanded = Semantics.isSubProcess(element) ? di.value('isExpanded') === true : undefined;
    const container = kind === 'participant' || kind === 'lane' || (kind === 'subProcess' && expanded === true);
    const hostId = kind === 'boundary' ? element.ref('attachedToRef')?.id : undefined;
    const laneId = kind === 'lane' ? this.semantics.laneParent.get(id) : this.semantics.laneOf.get(id);
    return { id, element, di, bounds, kind, container, expanded, label: DiagramReader.labelOf(di), hostId, laneId };
  }

  private edgeOf(di: BpmnNode, element: BpmnNode, id: string): PlaneEdge {
    const coordinate = (waypoint: BpmnNode, axis: string): number => (waypoint.value(axis) as number | undefined) ?? 0;
    const points = di.list('waypoint').map((waypoint) => ({ x: coordinate(waypoint, 'x'), y: coordinate(waypoint, 'y') }));
    return { id, element, di, kind: DiagramReader.kindOf(element, DiagramReader.EDGE_KINDS), points, label: DiagramReader.labelOf(di), ...DiagramReader.edgeEnds(element) };
  }

  private linkParents(plane: Plane): void {
    for (const shape of plane.shapes.values()) {
      const scope = this.semantics.scopeOf.get(shape.id);
      if (scope?.id && Semantics.isSubProcess(scope) && plane.shapes.get(scope.id)?.expanded) {
        shape.parentId = scope.id;
      }
    }
  }
}
