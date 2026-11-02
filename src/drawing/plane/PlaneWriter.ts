import { DrawingIds, Polyline, type Box, type BpmnElement, type BpmnTree, type Point } from '../../model/index.js';
import { PlaneEdge } from './PlaneEdge.js';
import { PlaneShape } from './PlaneShape.js';
import type { Plane } from './Plane.js';

export class PlaneWriter {
  constructor(private readonly tree: BpmnTree) {}

  write(planes: readonly Plane[]): void {
    const ids = new DrawingIds(this.tree.definitions);
    for (const plane of planes) {
      if (plane.deleted) {
        this.removeDiagramOf(plane);
      } else {
        this.writePlane(ids, plane);
      }
    }
  }

  private removeDiagramOf(plane: Plane): void {
    const diagram = plane.bpmnPlane?.parent;
    if (diagram) {
      this.tree.definitions.remove('diagrams', diagram);
    }
  }

  private writePlane(ids: DrawingIds, plane: Plane): void {
    const bpmnPlane = this.bpmnPlaneOf(ids, plane);
    for (const dropped of plane.dropped) {
      dropped.parent?.remove('planeElement', dropped);
    }
    plane.dropped = [];
    for (const shape of plane.shapes.values()) {
      this.writeShape(ids, bpmnPlane, shape);
    }
    for (const edge of plane.edges.values()) {
      this.writeEdge(ids, bpmnPlane, edge);
    }
  }

  private bpmnPlaneOf(ids: DrawingIds, plane: Plane): BpmnElement {
    if (plane.bpmnPlane) {
      if (plane.bpmnPlane.peek<BpmnElement>('bpmnElement') !== plane.root) {
        plane.bpmnPlane.set('bpmnElement', plane.root);
      }
      return plane.bpmnPlane;
    }
    const bpmnPlane = this.tree.build('bpmndi:BPMNPlane', { id: ids.plane(plane.rootId), bpmnElement: plane.root });
    const diagram = this.tree.build('bpmndi:BPMNDiagram', { id: ids.diagram(plane.rootId), plane: bpmnPlane });
    bpmnPlane.parent = diagram;
    this.tree.definitions.add('diagrams', diagram);
    plane.bpmnPlane = bpmnPlane;
    plane.id = bpmnPlane.peek<string>('id') ?? plane.id;
    return bpmnPlane;
  }

  private newBpmnShape(ids: DrawingIds, shape: PlaneShape): BpmnElement {
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

  private writeShape(ids: DrawingIds, bpmnPlane: BpmnElement, shape: PlaneShape): void {
    if (shape.planeElement) {
      this.adopt(bpmnPlane, shape.planeElement);
      if (shape.kind === 'subProcess' && shape.expanded !== undefined && (shape.planeElement.peek<boolean>('isExpanded') === true) !== shape.expanded) {
        shape.planeElement.set('isExpanded', shape.expanded);
      }
    } else {
      shape.planeElement = this.newBpmnShape(ids, shape);
      bpmnPlane.add('planeElement', shape.planeElement);
    }
    this.setBounds(shape.planeElement, shape.bounds);
    this.setLabel(shape.planeElement, shape.label);
  }

  private writeEdge(ids: DrawingIds, bpmnPlane: BpmnElement, edge: PlaneEdge): void {
    if (edge.planeElement) {
      this.adopt(bpmnPlane, edge.planeElement);
    } else {
      edge.planeElement = this.tree.build('bpmndi:BPMNEdge', { id: ids.edge(edge.id), bpmnElement: edge.el });
      bpmnPlane.add('planeElement', edge.planeElement);
    }
    this.setWaypoints(edge.planeElement, edge.points);
    this.setLabel(edge.planeElement, edge.label);
  }

  private adopt(bpmnPlane: BpmnElement, planeElement: BpmnElement): void {
    const { parent } = planeElement;
    if (parent !== bpmnPlane) {
      parent?.remove('planeElement', planeElement);
      bpmnPlane.add('planeElement', planeElement);
    }
  }

  private setBounds(owner: BpmnElement, box: Box): void {
    const current = owner.peek<BpmnElement>('bounds');
    const { x, y, width, height } = PlaneShape.storedBox(current, box);
    if (current) {
      Object.entries({ x, y, width, height }).forEach(([property, value]) => current.set(property, value));
    } else {
      const created = this.tree.build('dc:Bounds', { x, y, width, height });
      owner.set('bounds', created);
      created.parent = owner;
    }
  }

  private setLabel(planeElement: BpmnElement, label: Box | undefined): void {
    if (!label) {
      return;
    }
    let labelElement = planeElement.peek<BpmnElement>('label');
    if (!labelElement) {
      labelElement = this.tree.build('bpmndi:BPMNLabel');
      planeElement.set('label', labelElement);
      labelElement.parent = planeElement;
    }
    this.setBounds(labelElement, label);
  }

  private setWaypoints(planeElement: BpmnElement, points: readonly Point[]): void {
    if (!new Polyline(PlaneEdge.waypointsOf(planeElement)).same(new Polyline(points))) {
      planeElement.set('waypoint', PlaneEdge.writablePoints(points).map(({ x, y }) => this.waypoint(planeElement, x, y)));
    }
  }

  private waypoint(planeElement: BpmnElement, x: number, y: number): BpmnElement {
    const waypoint = this.tree.build('dc:Point', { x, y });
    waypoint.parent = planeElement;
    return waypoint;
  }
}
