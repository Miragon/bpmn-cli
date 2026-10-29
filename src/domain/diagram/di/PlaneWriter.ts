import type { BpmnModdle } from 'bpmn-moddle';
import { addTo, is, removeFrom, type El } from '../../document/utils/moddle.js';
import { roundPoints, sameBox, samePoints, type Box, type Point } from '../utils/geom.js';
import { boxOf, idOf, raw, rawList } from '../utils/raw.js';
import type { DEdge, DShape, Plane } from './types.js';
import { DiIds } from './DiIds.js';

/** Writes planes back into the moddle DI, rounding coordinates to whole pixels. */
export class PlaneWriter {
  constructor(
    private readonly moddle: BpmnModdle,
    private readonly defs: El,
  ) {}

  private rounded(box: Box): Box {
    return { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) };
  }

  private setBounds(owner: El, box: Box): void {
    const current = raw<El>(owner, 'bounds');
    if (current && sameBox(boxOf(current), box)) return;
    const rounded = this.rounded(box);
    if (current) {
      current.set('x', rounded.x);
      current.set('y', rounded.y);
      current.set('width', rounded.width);
      current.set('height', rounded.height);
    } else {
      const created = this.moddle.create('dc:Bounds', rounded);
      owner.set('bounds', created);
      created.$parent = owner;
    }
  }

  private setLabel(di: El, label: Box | undefined): void {
    if (!label) return;
    let lbl = raw<El>(di, 'label');
    if (!lbl) {
      lbl = this.moddle.create('bpmndi:BPMNLabel', {});
      di.set('label', lbl);
      lbl.$parent = di;
    }
    this.setBounds(lbl, label);
  }

  /** DI needs two waypoints, so rounding must not merge the ends into one. */
  private writablePoints(points: readonly Point[]): Point[] {
    const pts = roundPoints(points);
    if (pts.length >= 2 || points.length < 2) return pts;
    const last = points[points.length - 1]!;
    return [pts[0]!, { x: Math.round(last.x), y: Math.round(last.y) }];
  }

  private setWaypoints(di: El, points: Point[]): void {
    const current = rawList(di, 'waypoint').map((waypoint) => ({ x: raw<number>(waypoint, 'x') ?? NaN, y: raw<number>(waypoint, 'y') ?? NaN }));
    if (samePoints(current, points)) return;
    const pts = this.writablePoints(points).map((point) => {
      const waypoint = this.moddle.create('dc:Point', point);
      waypoint.$parent = di;
      return waypoint;
    });
    di.set('waypoint', pts);
  }

  private adopt(planeDi: El, di: El): void {
    const parent = di.$parent as El | undefined;
    if (parent === planeDi) return;
    if (parent) removeFrom(parent, 'planeElement', di);
    addTo(planeDi, 'planeElement', di);
  }

  private writeShape(ids: DiIds, planeDi: El, shape: DShape): void {
    if (!shape.di) {
      const attrs: Record<string, unknown> = { id: ids.shape(shape.id), bpmnElement: shape.el };
      if (shape.kind === 'participant' || shape.kind === 'lane') {
        attrs['isHorizontal'] = true;
      }
      if (shape.kind === 'subProcess') attrs['isExpanded'] = shape.expanded === true;
      if (is(shape.el, 'bpmn:ExclusiveGateway')) attrs['isMarkerVisible'] = true;
      shape.di = this.moddle.create('bpmndi:BPMNShape', attrs);
      addTo(planeDi, 'planeElement', shape.di);
    } else {
      this.adopt(planeDi, shape.di);
      if (shape.kind === 'subProcess' && shape.expanded !== undefined && (raw<boolean>(shape.di, 'isExpanded') === true) !== shape.expanded) {
        shape.di.set('isExpanded', shape.expanded);
      }
    }
    this.setBounds(shape.di, shape.bounds);
    this.setLabel(shape.di, shape.label);
  }

  private writeEdge(ids: DiIds, planeDi: El, edge: DEdge): void {
    if (!edge.di) {
      edge.di = this.moddle.create('bpmndi:BPMNEdge', { id: ids.edge(edge.id), bpmnElement: edge.el });
      addTo(planeDi, 'planeElement', edge.di);
    } else {
      this.adopt(planeDi, edge.di);
    }
    this.setWaypoints(edge.di, edge.points);
    this.setLabel(edge.di, edge.label);
  }

  private ensurePlaneDi(ids: DiIds, plane: Plane): El {
    if (plane.di) {
      if (raw<El>(plane.di, 'bpmnElement') !== plane.root) {
        plane.di.set('bpmnElement', plane.root);
      }
      return plane.di;
    }
    const di = this.moddle.create('bpmndi:BPMNPlane', { id: ids.plane(plane.rootId), bpmnElement: plane.root });
    const diagram = this.moddle.create('bpmndi:BPMNDiagram', { id: ids.diagram(plane.rootId), plane: di });
    di.$parent = diagram;
    addTo(this.defs, 'diagrams', diagram);
    plane.di = di;
    plane.id = idOf(di) ?? plane.id;
    return di;
  }

  /**
   * Updates existing DI in place, so colours and foreign attributes survive; creates DI in the
   * file's id style for new elements and deletes `plane.dropped`.
   */
  write(planes: readonly Plane[]): void {
    const ids = new DiIds(this.defs);
    for (const plane of planes) {
      if (plane.deleted) {
        const diagram = plane.di?.$parent as El | undefined;
        if (diagram) removeFrom(this.defs, 'diagrams', diagram);
        continue;
      }
      const planeDi = this.ensurePlaneDi(ids, plane);
      for (const droppedElement of plane.dropped) {
        const parent = droppedElement.$parent as El | undefined;
        if (parent) removeFrom(parent, 'planeElement', droppedElement);
      }
      plane.dropped = [];
      for (const shape of plane.shapes.values()) {
        this.writeShape(ids, planeDi, shape);
      }
      for (const edge of plane.edges.values()) {
        this.writeEdge(ids, planeDi, edge);
      }
    }
  }
}
