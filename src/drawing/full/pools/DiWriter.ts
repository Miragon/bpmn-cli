import { Box, BoxBorder, Point, type BpmnElement, type BpmnTree } from '../../../model/index.js';
import { ShapeSizes } from '../../plane/ShapeSizes.js';
import type { GNode, ScopeLayout } from '../scopes/GNode.js';
import type { LaneBox } from '../scopes/LaneBox.js';
import { ScopeLabels } from '../scopes/ScopeLabels.js';
import { LabelDeclutter } from './LabelDeclutter.js';

export interface EngineWarning {
  code: string;
  elementId: string;
  message: string;
}

interface ShapeOptions {
  extra?: Record<string, unknown>;
  label?: Box | undefined;
}

export class DiWriter {
  readonly di: BpmnElement[] = [];
  readonly absBoxes = new Map<string, Box>();

  private readonly crossLinks: ScopeLayout['crossLinks'] = [];

  constructor(private readonly tree: BpmnTree) {}

  private static shifted(box: Box, offset: Point): Box {
    return new Box(box.x + offset.x, box.y + offset.y, box.width, box.height);
  }

  private static shiftedPoints(points: readonly Point[], offset: Point): Point[] {
    return points.map((point) => new Point(point.x + offset.x, point.y + offset.y));
  }

  private static labelOf(node: GNode): Box | undefined {
    if (node.kind === 'gateway') {
      return ScopeLabels.of(node, 'gateway');
    }
    return node.el.is('bpmn:Event') ? ScopeLabels.of(node, 'event') : undefined;
  }

  shape(element: BpmnElement, box: Box, { extra = {}, label }: ShapeOptions = {}): void {
    const shapeDi = this.tree.build('bpmndi:BPMNShape', { id: `BPMNShape_${element.id}`, bpmnElement: element, bounds: this.bounds(box), ...extra });
    if (label) {
      shapeDi.set('label', this.tree.build('bpmndi:BPMNLabel', { bounds: this.bounds(label) }));
    }
    this.di.push(shapeDi);
    this.absBoxes.set(element.id, box.copy());
  }

  edge(element: BpmnElement, points: readonly Point[], label?: Box): void {
    const waypoint = points.map((point) => this.tree.build('dc:Point', { x: Math.round(point.x), y: Math.round(point.y) }));
    const edgeDi = this.tree.build('bpmndi:BPMNEdge', { id: `BPMNEdge_${element.id}`, bpmnElement: element, waypoint });
    if (label) {
      edgeDi.set('label', this.tree.build('bpmndi:BPMNLabel', { bounds: this.bounds(label) }));
    }
    this.di.push(edgeDi);
  }

  emitScope(scope: ScopeLayout, origin: Point): void {
    this.crossLinks.push(...scope.crossLinks);
    for (const lane of scope.lanes) {
      this.emitLane(lane, origin);
    }
    for (const node of [...scope.nodes, ...scope.eventSubs]) {
      this.emitNode(node, origin);
    }
    for (const edge of scope.edges) {
      this.edge(edge.el, DiWriter.shiftedPoints(edge.points, origin), edge.label && DiWriter.shifted(edge.label, origin));
    }
    for (const compensation of scope.compensations) {
      this.edge(compensation.el, DiWriter.shiftedPoints(compensation.points, origin));
    }
    for (const artifact of scope.artifacts) {
      const label = artifact.kind === 'annotation' ? undefined : ScopeLabels.of(artifact, 'data');
      this.shape(artifact.el, DiWriter.shifted(artifact.box, origin), { label: label && DiWriter.shifted(label, origin) });
      for (const link of artifact.links) {
        this.edge(link.el, DiWriter.shiftedPoints(link.points, origin));
      }
    }
  }

  fixLaneShapes(lane: LaneBox, poolBox: Box, baseX: number): void {
    const laneShape = this.di.find((element) => element.peek('bpmnElement') === lane.el);
    if (laneShape) {
      const bounds = laneShape.peek<BpmnElement>('bounds')!;
      bounds.set('x', baseX + lane.box.x);
      bounds.set('y', poolBox.y + lane.box.y);
      this.absBoxes.set(lane.id, new Box(baseX + lane.box.x, poolBox.y + lane.box.y, lane.box.width, lane.box.height));
    }
    for (const child of lane.children) {
      this.fixLaneShapes(child, poolBox, baseX);
    }
  }

  startPlane(): void {
    this.di.length = 0;
  }

  writePlane(definitions: BpmnElement, element: BpmnElement, id: string, warnings: EngineWarning[]): void {
    this.flushCrossLinks(warnings);
    new LabelDeclutter(this.di).run();
    const plane = this.tree.build('bpmndi:BPMNPlane', { id: `BPMNPlane_${id}`, bpmnElement: element });
    plane.add('planeElement', ...this.di);
    const diagram = this.tree.build('bpmndi:BPMNDiagram', { id: `BPMNDiagram_${id}`, plane });
    plane.parent = diagram;
    definitions.add('diagrams', diagram);
  }

  private flushCrossLinks(warnings: EngineWarning[]): void {
    const { absBoxes, crossLinks } = this;
    const here = new Set(this.di.filter((element) => element.is('bpmndi:BPMNShape')).map((element) => element.peek<BpmnElement>('bpmnElement')!.id));
    for (const link of crossLinks) {
      const sourceBox = here.has(link.sourceId) ? absBoxes.get(link.sourceId) : undefined;
      const targetBox = here.has(link.targetId) ? absBoxes.get(link.targetId) : undefined;
      if (sourceBox && targetBox) {
        this.edge(link.el, [new BoxBorder(sourceBox).pointTowards(targetBox.center), new BoxBorder(targetBox).pointTowards(sourceBox.center)]);
      } else {
        const toGroup = [link.el.peek<BpmnElement>('sourceRef'), link.el.peek<BpmnElement>('targetRef')].some((end) => end?.is('bpmn:Group'));
        warnings.push({ code: 'DI_NOT_CREATED', elementId: link.el.id, message: `No DI created for ${link.el.id} (${toGroup ? 'an end is a group: its box is drawn after the layout' : 'its ends are on different diagrams'})` });
      }
    }
    crossLinks.length = 0;
  }

  private bounds(box: Box): BpmnElement {
    return this.tree.build('dc:Bounds', { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) });
  }

  private emitLane(lane: LaneBox, origin: Point): void {
    this.shape(lane.el, DiWriter.shifted(lane.box, origin), { extra: { isHorizontal: true } });
    for (const child of lane.children) {
      this.emitLane(child, origin);
    }
  }

  private emitNode(node: GNode, origin: Point): void {
    const box = DiWriter.shifted(node.box, origin);
    if (node.child) {
      this.shape(node.el, box, { extra: { isExpanded: true } });
      this.emitChild(node, node.child, box);
    } else if (node.kind === 'subProcess' || node.kind === 'eventSubProcess') {
      this.shape(node.el, box);
    } else {
      const label = DiWriter.labelOf(node);
      this.shape(node.el, box, { extra: node.el.is('bpmn:ExclusiveGateway') ? { isMarkerVisible: true } : {}, label: label && DiWriter.shifted(label, origin) });
    }
    for (const event of node.boundary) {
      const label = ScopeLabels.of(event, 'boundary');
      this.shape(event.el, DiWriter.shifted(event.box, origin), { label: label && DiWriter.shifted(label, origin) });
    }
  }

  private emitChild(node: GNode, child: ScopeLayout, box: Box): void {
    const padding = ShapeSizes.SUB_PROCESS_PADDING;
    const pad = node.childPad ?? { left: 0, top: padding.top, inner: child.width };
    this.emitScope(child, new Point(box.x + padding.left + pad.left + Math.max(0, (box.width - padding.left - padding.right - pad.inner) / 2), box.y + pad.top));
  }
}
