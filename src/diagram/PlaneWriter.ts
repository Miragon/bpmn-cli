import type { BpmnModdle } from 'bpmn-moddle';
import { addTo, is, removeFrom, type El } from '../model/utils/moddle.js';
import { roundPoints, sameBox, samePoints, type Box, type Point } from './utils/geom.js';
import { idOf, raw, rawList } from './utils/raw.js';
import type { DEdge, DShape, Plane } from './types.js';
import { DiIds } from './DiIds.js';

/** Writes planes back into the moddle DI, rounding coordinates to whole pixels. */
export class PlaneWriter {
  constructor(
    private readonly moddle: BpmnModdle,
    private readonly defs: El,
  ) {}

  private rounded(b: Box): Box {
    return { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) };
  }

  private readBox(bounds: unknown): Box | undefined {
    if (!bounds) return undefined;
    return { x: raw<number>(bounds, 'x') ?? NaN, y: raw<number>(bounds, 'y') ?? NaN, width: raw<number>(bounds, 'width') ?? NaN, height: raw<number>(bounds, 'height') ?? NaN };
  }

  private setBounds(owner: El, b: Box): void {
    const current = raw<El>(owner, 'bounds');
    if (current && sameBox(this.readBox(current), b)) return;
    const r = this.rounded(b);
    if (current) {
      current.set('x', r.x);
      current.set('y', r.y);
      current.set('width', r.width);
      current.set('height', r.height);
    } else {
      const created = this.moddle.create('dc:Bounds', r);
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
    const current = rawList(di, 'waypoint').map((w) => ({ x: raw<number>(w, 'x') ?? NaN, y: raw<number>(w, 'y') ?? NaN }));
    if (samePoints(current, points)) return;
    const pts = this.writablePoints(points).map((p) => {
      const w = this.moddle.create('dc:Point', p);
      w.$parent = di;
      return w;
    });
    di.set('waypoint', pts);
  }

  private adopt(planeDi: El, di: El): void {
    const parent = di.$parent as El | undefined;
    if (parent === planeDi) return;
    if (parent) removeFrom(parent, 'planeElement', di);
    addTo(planeDi, 'planeElement', di);
  }

  private writeShape(ids: DiIds, planeDi: El, s: DShape): void {
    if (!s.di) {
      const attrs: Record<string, unknown> = { id: ids.shape(s.id), bpmnElement: s.el };
      if (s.kind === 'participant' || s.kind === 'lane') attrs['isHorizontal'] = true;
      if (s.kind === 'subProcess') attrs['isExpanded'] = s.expanded === true;
      if (is(s.el, 'bpmn:ExclusiveGateway')) attrs['isMarkerVisible'] = true;
      s.di = this.moddle.create('bpmndi:BPMNShape', attrs);
      addTo(planeDi, 'planeElement', s.di);
    } else {
      this.adopt(planeDi, s.di);
      if (s.kind === 'subProcess' && s.expanded !== undefined && (raw<boolean>(s.di, 'isExpanded') === true) !== s.expanded) s.di.set('isExpanded', s.expanded);
    }
    this.setBounds(s.di, s.bounds);
    this.setLabel(s.di, s.label);
  }

  private writeEdge(ids: DiIds, planeDi: El, e: DEdge): void {
    if (!e.di) {
      e.di = this.moddle.create('bpmndi:BPMNEdge', { id: ids.edge(e.id), bpmnElement: e.el });
      addTo(planeDi, 'planeElement', e.di);
    } else {
      this.adopt(planeDi, e.di);
    }
    this.setWaypoints(e.di, e.points);
    this.setLabel(e.di, e.label);
  }

  private ensurePlaneDi(ids: DiIds, plane: Plane): El {
    if (plane.di) {
      if (raw<El>(plane.di, 'bpmnElement') !== plane.root) plane.di.set('bpmnElement', plane.root);
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
      for (const d of plane.dropped) {
        const parent = d.$parent as El | undefined;
        if (parent) removeFrom(parent, 'planeElement', d);
      }
      plane.dropped = [];
      for (const s of plane.shapes.values()) this.writeShape(ids, planeDi, s);
      for (const e of plane.edges.values()) this.writeEdge(ids, planeDi, e);
    }
  }
}
