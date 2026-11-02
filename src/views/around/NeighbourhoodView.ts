import { FlowOrder } from '../../checks/index.js';
import type { BpmnDocument, BpmnElement } from '../../model/index.js';
import { ElementAnnotations, ElementData, ElementFacts, ElementLinks, ElementSummaries, type ViewAnnotation, type ViewData } from '../facts/index.js';
import type { ElementRef } from '../lines/index.js';
import { ModelView, ProcessOutline, type ModelViewData, type ViewNode, type ViewProcess } from '../model/index.js';
import { NeighbourhoodViewText } from './NeighbourhoodViewText.js';
import { NeighbourhoodWalk, type NeighbourhoodWindow } from './NeighbourhoodWalk.js';

export class NeighbourhoodView {
  private readonly links: ElementLinks;
  private readonly summaries: ElementSummaries;
  private readonly outline: ProcessOutline;
  private window!: NeighbourhoodWindow;
  private scopes = new Set<BpmnElement>();

  constructor(private readonly document: BpmnDocument) {
    this.links = new ElementLinks(document);
    this.summaries = new ElementSummaries(document);
    this.outline = new ProcessOutline(document);
  }

  private static refs(elements: readonly BpmnElement[]): ElementRef[] {
    return elements.map((element) => new ElementFacts(element).ref());
  }

  answer(id: string, depth?: number): { text: string; view: ModelViewData } {
    this.window = new NeighbourhoodWalk(this.document).window(id, depth);
    this.scopes = this.scopesOfWindow();
    const view = this.of(id);
    return { text: new NeighbourhoodViewText(view).text(), view };
  }

  private of(id: string): ModelViewData {
    const { process, depth, distances } = this.window;
    const inside = [...distances.keys()];
    const frame = new ModelView(this.document).frame();
    const nodes = this.nodesIn(process);
    const allFlows = this.links.scopesWithin(process).flatMap((scope) => this.document.flows.sequenceFlows(scope));
    const shownFlows = allFlows.filter((flow) => this.holds(flow.peek<BpmnElement>('sourceRef')) && this.holds(flow.peek<BpmnElement>('targetRef')));
    const messageFlows = this.document.flows.messageFlows().filter((flow) => this.holds(flow.peek<BpmnElement>('sourceRef')) || this.holds(flow.peek<BpmnElement>('targetRef')));
    const collaboration = frame.collaboration && { ...frame.collaboration, messageFlows: messageFlows.map((flow) => this.links.messageFlowEnds(flow)), annotations: undefined };
    const viewed: ViewProcess = { ...ProcessOutline.headerOf(this.document, process), lanes: [], nodes, data: this.data(inside), annotations: this.annotations(inside) };
    return {
      ...frame,
      collaboration,
      processes: [viewed],
      rootElements: [],
      cut: { around: new ElementFacts(this.document.tree.require(id)).ref(), depth, nodes: { shown: inside.length, total: new ElementData(this.document).nodesWithin(process).length }, flows: { shown: shownFlows.length, total: allFlows.length } },
    };
  }

  private holds(element: BpmnElement | undefined): element is BpmnElement {
    return !!element && this.window.distances.has(element);
  }

  private scopesOfWindow(): Set<BpmnElement> {
    const scopes = new Set<BpmnElement>([this.window.process]);
    for (const node of this.window.distances.keys()) {
      for (let scope = this.document.scopes.scopeOf(node); scope && !scopes.has(scope); scope = this.document.scopes.scopeOf(scope)) {
        scopes.add(scope);
      }
    }
    return scopes;
  }

  private nodesIn(scope: BpmnElement): ViewNode[] {
    const nodes = this.document.scopes.flowNodes(scope);
    const inOrder = new FlowOrder(this.document, scope).ordered.filter((node) => this.holds(node));
    const unhosted = nodes.filter((node) => node.is('bpmn:BoundaryEvent') && this.holds(node) && !this.hostsInWindow(node));
    const enclosing = nodes.filter((node) => node.is('bpmn:SubProcess') && !this.holds(node) && this.scopes.has(node));
    return [...new Set([...inOrder, ...unhosted, ...enclosing])].map((node) => this.node(node));
  }

  private hostsInWindow(event: BpmnElement): boolean {
    const host = event.peek<BpmnElement>('attachedToRef');
    return this.holds(host) && host.is('bpmn:Activity');
  }

  private node(node: BpmnElement): ViewNode {
    const { scopes, flows } = this.document;
    const isSubProcess = node.is('bpmn:SubProcess');
    const inner = isSubProcess ? scopes.flowNodes(node).filter((child) => !child.is('bpmn:BoundaryEvent')) : [];
    const boundary = node.is('bpmn:Activity') ? scopes.boundaryEventsOf(node).filter((event) => this.holds(event)) : [];
    const outside = flows.incoming(node).filter((flow) => !this.holds(flow.peek<BpmnElement>('sourceRef')));
    const host = node.is('bpmn:BoundaryEvent') ? node.peek<BpmnElement>('attachedToRef') : undefined;
    return {
      ...this.summaries.summary(node, { zeebe: false }),
      incoming: NeighbourhoodView.refs(flows.incoming(node)),
      distance: this.window.distances.get(node),
      host: host && new ElementFacts(host).ref(),
      expanded: isSubProcess ? this.outline.expanded(node) : undefined,
      content: inner.length && !inner.some((child) => this.holds(child)) ? inner.length : undefined,
      impl: new ElementFacts(node).implementation(),
      from: outside.length ? outside.map((flow) => ({ ...new ElementFacts(flow).ref(), ...new ElementFacts(flow).flowTraits(), source: ElementFacts.refOf(flow.peek<BpmnElement>('sourceRef')) })) : undefined,
      boundary: boundary.length ? boundary.map((event) => this.node(event)) : undefined,
      children: this.scopes.has(node) ? this.nodesIn(node) : undefined,
    };
  }

  private annotations(inside: readonly BpmnElement[]): ViewAnnotation[] {
    const annotations = new Map<string, ViewAnnotation>();
    const found = new ElementAnnotations(this.document);
    for (const element of inside) {
      for (const annotation of found.at(element)) {
        const known = annotations.get(annotation.id) ?? { ...ElementAnnotations.textOf(annotation), attachedTo: [] };
        known.attachedTo.push(new ElementFacts(element).ref());
        annotations.set(annotation.id, known);
      }
    }
    return [...annotations.values()];
  }

  private data(inside: readonly BpmnElement[]): ViewData[] {
    const data = new Map<string, ViewData>();
    const note = (reference: BpmnElement, side: 'from' | 'to', user: BpmnElement): void => {
      const entry = data.get(reference.id) ?? ElementData.empty(reference);
      entry[side].push(new ElementFacts(user).ref());
      data.set(reference.id, entry);
    };
    for (const element of inside) {
      const { reads, writes } = ElementData.of(element);
      reads.forEach((reference) => note(reference, 'to', element));
      writes.forEach((reference) => note(reference, 'from', element));
    }
    return [...data.values()];
  }
}
