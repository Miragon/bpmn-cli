import { Box, DiagramIndex, Point, type BpmnDocument, type BpmnElement } from '../../model/index.js';
import { DrawnEdge, type EdgeDrawing } from './DrawnEdge.js';
import { DrawnShape, type ShapeDrawing } from './DrawnShape.js';
import type { ElementHomes } from './ElementHomes.js';

export interface PlaneDrawing {
  shapes: Iterable<ShapeDrawing>;
  edges: Iterable<EdgeDrawing>;
  root?: string | undefined;
  unmeasuredIds?: readonly string[];
}

export type DrawnLabel = { owner: string; box: Box; text: Box };

type PlaneRead = PlaneDrawing & { shapes: ShapeDrawing[]; edges: EdgeDrawing[]; unmeasuredIds: string[] };

export class DrawnPlane {
  readonly root: string | undefined;
  readonly shapes: readonly DrawnShape[];
  readonly edges: readonly DrawnEdge[];
  readonly leaves: readonly DrawnShape[];
  readonly frames: readonly DrawnShape[];
  readonly pools: readonly DrawnShape[];
  readonly sequenceFlows: readonly DrawnEdge[];
  readonly labels: readonly DrawnLabel[];
  private readonly shapesById: ReadonlyMap<string | undefined, DrawnShape>;
  private readonly edgesById: ReadonlyMap<string | undefined, DrawnEdge>;

  constructor(
    drawing: PlaneDrawing,
    readonly homes: ElementHomes,
    private readonly shownIds: Set<string>,
  ) {
    this.root = drawing.root;
    this.shapes = [...drawing.shapes].map(({ id, el, bounds, expanded, label }) => new DrawnShape(id, el, bounds, !!expanded, label));
    this.edges = [...drawing.edges].map(({ id, el, points, label }) => new DrawnEdge(id, el, points, label));
    this.leaves = this.shapes.filter((shape) => !shape.isFrame && !shape.el.is('bpmn:Group'));
    this.frames = this.shapes.filter((shape) => shape.isFrame);
    this.pools = this.shapes.filter((shape) => shape.isPool);
    this.sequenceFlows = this.edges.filter((edge) => edge.isSequenceFlow);
    this.labels = [...this.shapes, ...this.edges].flatMap(({ id, el, label }) => (label ? [{ owner: id, box: label, text: DrawnPlane.glyph(label, el.peek<string>('name') || '') }] : []));
    this.shapesById = new Map(this.shapes.map((shape) => [shape.id, shape]));
    this.edgesById = new Map(this.edges.map((edge) => [edge.id, edge]));
    for (const id of [...this.shapesById.keys(), ...this.edgesById.keys(), ...(drawing.unmeasuredIds ?? [])]) {
      shownIds.add(id as string);
    }
  }

  static read(document: BpmnDocument): PlaneDrawing[] {
    const displayRoot = DiagramIndex.displayRoot(document.tree.definitions)?.id;
    return document.diagram.planes().map((plane) => DrawnPlane.readPlane(plane, displayRoot));
  }

  static of(drawings: readonly PlaneDrawing[], homes: ElementHomes): DrawnPlane[] {
    const shownIds = new Set<string>();
    const planes: readonly PlaneDrawing[] = drawings.length ? drawings : [{ shapes: [], edges: [] }];
    return planes.map((drawing) => new DrawnPlane(drawing, homes, shownIds));
  }

  static *pairs<TItem>(items: readonly TItem[]): Generator<[TItem, TItem]> {
    for (let first = 0; first < items.length; first++) {
      for (let second = first + 1; second < items.length; second++) {
        yield [items[first]!, items[second]!];
      }
    }
  }

  static glyph(label: Box, name: string): Box {
    const estimate = Math.max(6, name.length * 6);
    const width = Math.min(estimate, 90);
    return new Box(label.center.x - width / 2, label.y, width, Math.max(1, Math.ceil(estimate / 90)) * 14);
  }

  private static boxOf(bounds: BpmnElement | undefined): Box | undefined {
    const [x, y, width, height] = ['x', 'y', 'width', 'height'].map((name) => bounds?.peek<number>(name)) as [number, number, number, number];
    return bounds && new Box(x, y, width, height);
  }

  private static readPlane(plane: BpmnElement, displayRoot: string | undefined): PlaneRead {
    const read: PlaneRead = { shapes: [], edges: [], root: plane.peek<BpmnElement>('bpmnElement')?.id ?? displayRoot, unmeasuredIds: [] };
    for (const planeElement of plane.list('planeElement')) {
      const el = planeElement.peek<BpmnElement>('bpmnElement');
      if (el?.id) {
        DrawnPlane.readElement(planeElement, el, read);
      }
    }
    return read;
  }

  private static readElement(planeElement: BpmnElement, el: BpmnElement, read: PlaneRead): void {
    const { id } = el;
    const label = DrawnPlane.boxOf(planeElement.peek<BpmnElement>('label')?.peek<BpmnElement>('bounds'));
    const bounds = DrawnPlane.boxOf(planeElement.peek<BpmnElement>('bounds'));
    if (planeElement.is('bpmndi:BPMNShape') && bounds) {
      read.shapes.push({ id, el, bounds, label, expanded: planeElement.peek<boolean>('isExpanded') });
    } else if (planeElement.is('bpmndi:BPMNEdge')) {
      const points = planeElement.list('waypoint').map((waypoint) => new Point(waypoint.peek<number>('x')!, waypoint.peek<number>('y')!));
      read.edges.push({ id, el, points, label });
    } else {
      read.unmeasuredIds.push(id);
    }
  }

  shape(id: string | undefined): DrawnShape | undefined {
    return this.shapesById.get(id);
  }

  edge(id: string | undefined): DrawnEdge | undefined {
    return this.edgesById.get(id);
  }

  shows(id: string): boolean {
    return this.shownIds.has(id);
  }

  poolOf(process: BpmnElement | undefined): DrawnShape | undefined {
    return this.shape(this.homes.pools.get(process?.id)?.id);
  }

  expandedSubProcess(parent: BpmnElement | undefined): DrawnShape | undefined {
    const shape = parent?.is('bpmn:SubProcess') ? this.shape(parent.id) : undefined;
    return shape?.expanded ? shape : undefined;
  }

  namedOuterLabels(): Array<DrawnShape | DrawnEdge> {
    const owners = [...this.shapes.filter((shape) => shape.isLabelledOutside), ...this.edges.filter((edge) => edge.isSequenceFlow || edge.isMessageFlow)];
    return owners.filter(({ el, label }) => label && el.peek<string>('name')?.trim());
  }
}
