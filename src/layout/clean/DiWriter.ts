import { addTo, is, type El, type Model, idOf } from '../../model/utils/moddle.js';
import { SIZES, center, type Box, type GNode, type LaneBox, type Point, type ScopeLayout } from '../../diagram/types.js';
import type { EngineWarning } from './CleanEngine.js';
import { LabelDeclutter } from './LabelDeclutter.js';
import type { PoolLayout } from './PoolStacker.js';
import { borderPoint } from './route.js';
import { ScopeLabels } from './ScopeLabels.js';

export class DiWriter {
  readonly di: El[] = [];
  readonly absBoxes = new Map<string, Box>();
  /** data associations whose ends live in different scopes: drawn once both shapes exist */
  private readonly crossLinks: Array<{ el: El; sourceId: string; targetId: string }> = [];

  constructor(private readonly moddle: Model['moddle']) {}

  shape(el: El, box: Box, extra: Record<string, unknown> = {}, label?: Box): void {
    const { moddle } = this;
    const s = moddle.create('bpmndi:BPMNShape', { id: `BPMNShape_${idOf(el)}`, bpmnElement: el, bounds: this.bounds(box), ...extra });
    if (label) s.set('label', moddle.create('bpmndi:BPMNLabel', { bounds: this.bounds(label) }));
    this.di.push(s);
    this.absBoxes.set(idOf(el), { ...box });
  }

  edge(el: El, points: Point[], label?: Box): void {
    const { moddle } = this;
    const e = moddle.create('bpmndi:BPMNEdge', { id: `BPMNEdge_${idOf(el)}`, bpmnElement: el, waypoint: points.map((p) => moddle.create('dc:Point', { x: Math.round(p.x), y: Math.round(p.y) })) });
    if (label) e.set('label', moddle.create('bpmndi:BPMNLabel', { bounds: this.bounds(label) }));
    this.di.push(e);
  }

  emitScope(scope: ScopeLayout, origin: Point): void {
    this.crossLinks.push(...scope.crossLinks);
    for (const lane of scope.lanes) this.emitLane(lane, origin);
    for (const n of [...scope.nodes, ...scope.eventSubs]) this.emitNode(n, origin);
    for (const e of scope.edges) this.edge(e.el, this.shiftPts(e.points, origin), e.label ? this.shift(e.label, origin) : undefined);
    for (const c of scope.compensations) this.edge(c.el, this.shiftPts(c.points, origin));
    for (const a of scope.artifacts) {
      const box = this.shift(a.box, origin);
      const label = a.kind === 'annotation' ? undefined : ScopeLabels.of(a, 'data');
      this.shape(a.el, box, {}, label ? this.shift(label, origin) : undefined);
      for (const link of a.links) this.edge(link.el, this.shiftPts(link.points, origin));
    }
  }

  /** lane shapes are placed at the pool's left edge (after the participant header) */
  fixLaneShapes(lane: LaneBox, pool: PoolLayout, processOnly = false): void {
    const s = this.di.find((d) => d.get<El>('bpmnElement') === lane.el);
    if (s) {
      const b = s.get<El>('bounds');
      const baseX = processOnly ? pool.box.x : pool.box.x + SIZES.participantHeader;
      b.set('x', baseX + lane.box.x);
      b.set('y', pool.box.y + lane.box.y);
      this.absBoxes.set(lane.id, { x: baseX + lane.box.x, y: pool.box.y + lane.box.y, width: lane.box.width, height: lane.box.height });
    }
    for (const c of lane.children) this.fixLaneShapes(c, pool, processOnly);
  }

  startPlane(): void {
    this.di.length = 0;
  }

  writePlane(definitions: El, element: El, id: string, warnings: EngineWarning[]): void {
    const { moddle } = this;
    this.flushCrossLinks(warnings);
    new LabelDeclutter(this.di).run();
    const plane = moddle.create('bpmndi:BPMNPlane', { id: `BPMNPlane_${id}`, bpmnElement: element });
    addTo(plane, 'planeElement', ...this.di);
    const diagram = moddle.create('bpmndi:BPMNDiagram', { id: `BPMNDiagram_${id}`, plane });
    plane.$parent = diagram;
    addTo(definitions, 'diagrams', diagram);
  }

  /** Links between scopes of the plane just emitted: a straight line when both ends are on it, else a warning. */
  private flushCrossLinks(warnings: EngineWarning[]): void {
    const { absBoxes, crossLinks } = this;
    const here = new Set(this.di.filter((d) => is(d, 'bpmndi:BPMNShape')).map((d) => idOf(d.get<El>('bpmnElement'))));
    for (const link of crossLinks) {
      const sb = here.has(link.sourceId) ? absBoxes.get(link.sourceId) : undefined;
      const tb = here.has(link.targetId) ? absBoxes.get(link.targetId) : undefined;
      if (!sb || !tb) {
        const toGroup = [link.el.get<El | undefined>('sourceRef'), link.el.get<El | undefined>('targetRef')].some((end) => is(end, 'bpmn:Group'));
        warnings.push({ code: 'DI_NOT_CREATED', elementId: idOf(link.el), message: `No DI created for ${idOf(link.el)} (${toGroup ? 'an end is a group: its box is drawn after the layout' : 'its ends are on different diagrams'})` });
        continue;
      }
      this.edge(link.el, [borderPoint(sb, center(tb)), borderPoint(tb, center(sb))]);
    }
    crossLinks.length = 0;
  }

  private bounds(b: Box): El {
    return this.moddle.create('dc:Bounds', { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) });
  }

  private shift(b: Box, o: Point): Box {
    return { x: b.x + o.x, y: b.y + o.y, width: b.width, height: b.height };
  }

  private shiftPts(pts: Point[], o: Point): Point[] {
    return pts.map((p) => ({ x: p.x + o.x, y: p.y + o.y }));
  }

  private emitLane(lane: LaneBox, origin: Point): void {
    this.shape(lane.el, this.shift(lane.box, origin), { isHorizontal: true });
    for (const c of lane.children) this.emitLane(c, origin);
  }

  private emitNode(n: GNode, origin: Point): void {
    const box = this.shift(n.box, origin);
    if (n.child) {
      this.shape(n.el, box, { isExpanded: true });
      const p = SIZES.subProcessPadding;
      const pad = n.childPad ?? { left: 0, top: p.top, inner: n.child.width };
      this.emitScope(n.child, { x: box.x + p.left + pad.left + Math.max(0, (box.width - p.left - p.right - pad.inner) / 2), y: box.y + pad.top });
    } else if (n.kind === 'subProcess' || n.kind === 'eventSubProcess') {
      this.shape(n.el, box); // collapsed: own plane
    } else {
      const kind = n.kind === 'gateway' ? 'gateway' : is(n.el, 'bpmn:Event') ? 'event' : undefined;
      const label = kind ? ScopeLabels.of(n, kind) : undefined;
      const extra = is(n.el, 'bpmn:ExclusiveGateway') ? { isMarkerVisible: true } : {};
      this.shape(n.el, box, extra, label ? this.shift(label, origin) : undefined);
    }
    for (const b of n.boundary) {
      const bb = this.shift(b.box, origin);
      const label = ScopeLabels.of(b, 'boundary');
      this.shape(b.el, bb, {}, label ? this.shift(label, origin) : undefined);
    }
  }
}
