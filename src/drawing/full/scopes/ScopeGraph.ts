import type { BpmnElement } from '../../../model/index.js';
import { ShapeSizes } from '../../plane/ShapeSizes.js';
import { BackEdges } from './BackEdges.js';
import { GNode, type GEdge, type GNodeKind, type ScopeLayout } from './GNode.js';
import { ScopeGrid } from './ScopeGrid.js';

export class ScopeGraph {
  readonly layout: ScopeLayout;
  readonly byId = new Map<string, GNode>();

  constructor(scope: BpmnElement, nest: (node: GNode) => void) {
    const flowElements = scope.list('flowElements');
    const nodes: GNode[] = [];
    const eventSubs: GNode[] = [];
    this.addFlowNodes(flowElements, nest, nodes, eventSubs);
    this.addBoundaryEvents(flowElements, nodes);
    this.layout = { el: scope, nodes, edges: this.edgesOf(flowElements), artifacts: [], eventSubs, compensations: [], width: 0, height: 0, lanes: [], crossLinks: [] };
    this.addCompensations(scope);
    new BackEdges(this.layout).mark();
  }

  private static kindOfNode(element: BpmnElement): GNodeKind {
    if (element.is('bpmn:StartEvent')) {
      return 'start';
    }
    if (element.is('bpmn:EndEvent')) {
      return 'end';
    }
    if (element.is('bpmn:Event')) {
      return 'event';
    }
    if (element.is('bpmn:Gateway')) {
      return 'gateway';
    }
    if (element.is('bpmn:SubProcess')) {
      return element.get<boolean | undefined>('triggeredByEvent') ? 'eventSubProcess' : 'subProcess';
    }
    return 'task';
  }

  private addFlowNodes(flowElements: readonly BpmnElement[], nest: (node: GNode) => void, nodes: GNode[], eventSubs: GNode[]): void {
    for (const element of flowElements) {
      if (element.is('bpmn:FlowNode') && !element.is('bpmn:BoundaryEvent')) {
        const kind = ScopeGraph.kindOfNode(element);
        const node = new GNode(element, element.id, ShapeSizes.of(element), kind);
        if (kind === 'subProcess' || kind === 'eventSubProcess') {
          nest(node);
        }
        this.byId.set(node.id, node);
        (kind === 'eventSubProcess' ? eventSubs : nodes).push(node);
      }
    }
  }

  private addBoundaryEvents(flowElements: readonly BpmnElement[], nodes: GNode[]): void {
    for (const element of flowElements) {
      if (element.is('bpmn:BoundaryEvent')) {
        const node = new GNode(element, element.id, ShapeSizes.EVENT, 'event');
        const hostId = element.peek<BpmnElement>('attachedToRef')?.id;
        const host = hostId === undefined ? undefined : this.byId.get(hostId);
        if (host) {
          node.host = host;
          host.boundary.push(node);
        } else {
          nodes.push(node);
        }
        this.byId.set(node.id, node);
      }
    }
    for (const host of this.byId.values()) {
      ScopeGrid.spreadOverBorders(host);
    }
  }

  private nodeOf(end: BpmnElement | undefined): GNode | undefined {
    return end && this.byId.get(end.id);
  }

  private edgesOf(flowElements: readonly BpmnElement[]): GEdge[] {
    const edges: GEdge[] = [];
    for (const element of flowElements) {
      const source = element.is('bpmn:SequenceFlow') ? this.nodeOf(element.peek<BpmnElement>('sourceRef')) : undefined;
      const target = element.is('bpmn:SequenceFlow') ? this.nodeOf(element.peek<BpmnElement>('targetRef')) : undefined;
      if (source && target) {
        const edge: GEdge = { el: element, id: element.id, source, target, back: false, points: [] };
        source.out.push(edge);
        target.in.push(edge);
        edges.push(edge);
      }
    }
    return edges;
  }

  private addCompensations(scope: BpmnElement): void {
    for (const element of scope.list('artifacts')) {
      const event = element.is('bpmn:Association') ? this.nodeOf(element.peek<BpmnElement>('sourceRef')) : undefined;
      const handler = element.is('bpmn:Association') ? this.nodeOf(element.peek<BpmnElement>('targetRef')) : undefined;
      if (event?.host && handler && event.el.is('bpmn:BoundaryEvent') && !handler.in.length && handler.el.is('bpmn:Activity')) {
        event.compensationHandler = handler;
        handler.compensatedBy = event;
        this.layout.compensations.push({ el: element, id: element.id, event, handler, points: [] });
      }
    }
  }
}
