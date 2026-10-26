import { addTo, is, type El, type Model, idOf } from '../../../document/utils/moddle.js';
import { SIZES } from '../../utils/sizes.js';
import { center, borderPoint } from '../../utils/geom.js';
import type { Box, GNode, LaneBox, Point, ScopeLayout } from '../../di/types.js';
import type { EngineWarning } from './CleanEngine.js';
import { LabelDeclutter } from './LabelDeclutter.js';
import type { PoolLayout } from './PoolStacker.js';
import { ScopeLabels } from './ScopeLabels.js';

export class DiWriter {
  readonly di: El[] = [];
  readonly absBoxes = new Map<string, Box>();
  /** drawn once both shapes exist */
  private readonly crossLinks: Array<{ el: El; sourceId: string; targetId: string }> = [];

  constructor(private readonly moddle: Model['moddle']) {}

  shape(el: El, box: Box, extra: Record<string, unknown> = {}, label?: Box): void {
    const { moddle } = this;
    const shapeDi = moddle.create('bpmndi:BPMNShape', { id: `BPMNShape_${idOf(el)}`, bpmnElement: el, bounds: this.bounds(box), ...extra });
    if (label) shapeDi.set('label', moddle.create('bpmndi:BPMNLabel', { bounds: this.bounds(label) }));
    this.di.push(shapeDi);
    this.absBoxes.set(idOf(el), { ...box });
  }

  edge(el: El, points: Point[], label?: Box): void {
    const { moddle } = this;
    const edgeDi = moddle.create('bpmndi:BPMNEdge', { id: `BPMNEdge_${idOf(el)}`, bpmnElement: el, waypoint: points.map((point) => moddle.create('dc:Point', { x: Math.round(point.x), y: Math.round(point.y) })) });
    if (label) edgeDi.set('label', moddle.create('bpmndi:BPMNLabel', { bounds: this.bounds(label) }));
    this.di.push(edgeDi);
  }

  emitScope(scope: ScopeLayout, origin: Point): void {
    this.crossLinks.push(...scope.crossLinks);
    for (const lane of scope.lanes) this.emitLane(lane, origin);
    for (const node of [...scope.nodes, ...scope.eventSubs]) this.emitNode(node, origin);
    for (const edge of scope.edges) this.edge(edge.el, this.shiftPts(edge.points, origin), edge.label ? this.shift(edge.label, origin) : undefined);
    for (const compensation of scope.compensations) this.edge(compensation.el, this.shiftPts(compensation.points, origin));
    for (const artifact of scope.artifacts) {
      const box = this.shift(artifact.box, origin);
      const label = artifact.kind === 'annotation' ? undefined : ScopeLabels.of(artifact, 'data');
      this.shape(artifact.el, box, {}, label ? this.shift(label, origin) : undefined);
      for (const link of artifact.links) this.edge(link.el, this.shiftPts(link.points, origin));
    }
  }

  fixLaneShapes(lane: LaneBox, pool: PoolLayout, processOnly = false): void {
    const laneShape = this.di.find((diagramElement) => diagramElement.get<El>('bpmnElement') === lane.el);
    if (laneShape) {
      const bounds = laneShape.get<El>('bounds');
      const baseX = processOnly ? pool.box.x : pool.box.x + SIZES.participantHeader;
      bounds.set('x', baseX + lane.box.x);
      bounds.set('y', pool.box.y + lane.box.y);
      this.absBoxes.set(lane.id, { x: baseX + lane.box.x, y: pool.box.y + lane.box.y, width: lane.box.width, height: lane.box.height });
    }
    for (const childLane of lane.children) this.fixLaneShapes(childLane, pool, processOnly);
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

  private flushCrossLinks(warnings: EngineWarning[]): void {
    const { absBoxes, crossLinks } = this;
    const here = new Set(this.di.filter((diagramElement) => is(diagramElement, 'bpmndi:BPMNShape')).map((diagramElement) => idOf(diagramElement.get<El>('bpmnElement'))));
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

  private bounds(box: Box): El {
    return this.moddle.create('dc:Bounds', { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) });
  }

  private shift(box: Box, offset: Point): Box {
    return { x: box.x + offset.x, y: box.y + offset.y, width: box.width, height: box.height };
  }

  private shiftPts(pts: Point[], offset: Point): Point[] {
    return pts.map((point) => ({ x: point.x + offset.x, y: point.y + offset.y }));
  }

  private emitLane(lane: LaneBox, origin: Point): void {
    this.shape(lane.el, this.shift(lane.box, origin), { isHorizontal: true });
    for (const childLane of lane.children) this.emitLane(childLane, origin);
  }

  private emitNode(node: GNode, origin: Point): void {
    const box = this.shift(node.box, origin);
    if (node.child) {
      this.shape(node.el, box, { isExpanded: true });
      const padding = SIZES.subProcessPadding;
      const pad = node.childPad ?? { left: 0, top: padding.top, inner: node.child.width };
      this.emitScope(node.child, { x: box.x + padding.left + pad.left + Math.max(0, (box.width - padding.left - padding.right - pad.inner) / 2), y: box.y + pad.top });
    } else if (node.kind === 'subProcess' || node.kind === 'eventSubProcess') {
      this.shape(node.el, box); // collapsed: own plane
    } else {
      const kind = node.kind === 'gateway' ? 'gateway' : is(node.el, 'bpmn:Event') ? 'event' : undefined;
      const label = kind ? ScopeLabels.of(node, kind) : undefined;
      const extra = is(node.el, 'bpmn:ExclusiveGateway') ? { isMarkerVisible: true } : {};
      this.shape(node.el, box, extra, label ? this.shift(label, origin) : undefined);
    }
    for (const boundaryEvent of node.boundary) {
      const bb = this.shift(boundaryEvent.box, origin);
      const label = ScopeLabels.of(boundaryEvent, 'boundary');
      this.shape(boundaryEvent.el, bb, {}, label ? this.shift(label, origin) : undefined);
    }
  }
}
