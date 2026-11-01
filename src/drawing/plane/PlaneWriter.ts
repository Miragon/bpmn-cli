import { DiIds, Polyline, type Box, type BpmnElement, type BpmnTree, type Point } from '../../model/index.js';
import { DEdge } from './DEdge.js';
import { DShape } from './DShape.js';
import type { Plane } from './Plane.js';

export class PlaneWriter {
  constructor(private readonly tree: BpmnTree) {}

  write(planes: readonly Plane[]): void {
    const ids = new DiIds(this.tree.definitions);
    for (const plane of planes) {
      if (plane.deleted) {
        this.removeDiagramOf(plane);
      } else {
        this.writePlane(ids, plane);
      }
    }
  }

  private removeDiagramOf(plane: Plane): void {
    const diagram = plane.di?.parent;
    if (diagram) {
      this.tree.definitions.remove('diagrams', diagram);
    }
  }

  private writePlane(ids: DiIds, plane: Plane): void {
    const planeDi = this.planeDiOf(ids, plane);
    for (const dropped of plane.dropped) {
      dropped.parent?.remove('planeElement', dropped);
    }
    plane.dropped = [];
    for (const shape of plane.shapes.values()) {
      this.writeShape(ids, planeDi, shape);
    }
    for (const edge of plane.edges.values()) {
      this.writeEdge(ids, planeDi, edge);
    }
  }

  private planeDiOf(ids: DiIds, plane: Plane): BpmnElement {
    if (plane.di) {
      if (plane.di.peek<BpmnElement>('bpmnElement') !== plane.root) {
        plane.di.set('bpmnElement', plane.root);
      }
      return plane.di;
    }
    const di = this.tree.build('bpmndi:BPMNPlane', { id: ids.plane(plane.rootId), bpmnElement: plane.root });
    const diagram = this.tree.build('bpmndi:BPMNDiagram', { id: ids.diagram(plane.rootId), plane: di });
    di.parent = diagram;
    this.tree.definitions.add('diagrams', diagram);
    plane.di = di;
    plane.id = di.peek<string>('id') ?? plane.id;
    return di;
  }

  private newShapeDi(ids: DiIds, shape: DShape): BpmnElement {
    const attributes: Record<string, unknown> = { id: ids.shape(shape.id), bpmnElement: shape.el };
    if (shape.kind === 'participant' || shape.kind === 'lane') {
      attributes['isHorizontal'] = true;
    }
    if (shape.kind === 'subProcess') {
      attributes['isExpanded'] = shape.expanded === true;
    }
    if (shape.el.is('bpmn:ExclusiveGateway')) {
      attributes['isMarkerVisible'] = true;
    }
    return this.tree.build('bpmndi:BPMNShape', attributes);
  }

  private writeShape(ids: DiIds, planeDi: BpmnElement, shape: DShape): void {
    if (shape.di) {
      this.adopt(planeDi, shape.di);
      if (shape.kind === 'subProcess' && shape.expanded !== undefined && (shape.di.peek<boolean>('isExpanded') === true) !== shape.expanded) {
        shape.di.set('isExpanded', shape.expanded);
      }
    } else {
      shape.di = this.newShapeDi(ids, shape);
      planeDi.add('planeElement', shape.di);
    }
    this.setBounds(shape.di, shape.bounds);
    this.setLabel(shape.di, shape.label);
  }

  private writeEdge(ids: DiIds, planeDi: BpmnElement, edge: DEdge): void {
    if (edge.di) {
      this.adopt(planeDi, edge.di);
    } else {
      edge.di = this.tree.build('bpmndi:BPMNEdge', { id: ids.edge(edge.id), bpmnElement: edge.el });
      planeDi.add('planeElement', edge.di);
    }
    this.setWaypoints(edge.di, edge.points);
    this.setLabel(edge.di, edge.label);
  }

  private adopt(planeDi: BpmnElement, di: BpmnElement): void {
    const { parent } = di;
    if (parent !== planeDi) {
      parent?.remove('planeElement', di);
      planeDi.add('planeElement', di);
    }
  }

  private setBounds(owner: BpmnElement, box: Box): void {
    const current = owner.peek<BpmnElement>('bounds');
    const { x, y, width, height } = DShape.storedBox(current, box);
    if (current) {
      Object.entries({ x, y, width, height }).forEach(([property, value]) => current.set(property, value));
    } else {
      const created = this.tree.build('dc:Bounds', { x, y, width, height });
      owner.set('bounds', created);
      created.parent = owner;
    }
  }

  private setLabel(di: BpmnElement, label: Box | undefined): void {
    if (!label) {
      return;
    }
    let labelDi = di.peek<BpmnElement>('label');
    if (!labelDi) {
      labelDi = this.tree.build('bpmndi:BPMNLabel');
      di.set('label', labelDi);
      labelDi.parent = di;
    }
    this.setBounds(labelDi, label);
  }

  private setWaypoints(di: BpmnElement, points: readonly Point[]): void {
    if (!new Polyline(DEdge.waypointsOf(di)).same(new Polyline(points))) {
      di.set('waypoint', DEdge.writablePoints(points).map(({ x, y }) => this.waypoint(di, x, y)));
    }
  }

  private waypoint(di: BpmnElement, x: number, y: number): BpmnElement {
    const waypoint = this.tree.build('dc:Point', { x, y });
    waypoint.parent = di;
    return waypoint;
  }
}
