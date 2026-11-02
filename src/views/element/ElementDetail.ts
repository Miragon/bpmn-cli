import { FlowOrder } from '../../checks/index.js';
import type { BpmnDocument, BpmnElement } from '../../model/index.js';
import { ElementAnnotations, ElementData, ElementFacts, ElementLinks, ElementSummaries, ExtensionLister } from '../facts/index.js';
import type { ElementRef } from '../lines/index.js';
import { ElementCatches } from './ElementCatches.js';
import { ElementDetailText, type ElementDetailData, type ElementLane, type ElementLink } from './ElementDetailText.js';
import { ElementMessages } from './ElementMessages.js';
import { ElementProperties } from './ElementProperties.js';

export class ElementDetail {
  private readonly links: ElementLinks;
  private readonly catches: ElementCatches;
  private readonly messages: ElementMessages;

  constructor(private readonly document: BpmnDocument) {
    this.links = new ElementLinks(document);
    this.catches = new ElementCatches(document);
    this.messages = new ElementMessages(document, this.links);
  }

  private static parentLanes(lane: BpmnElement): BpmnElement[] {
    const parents: BpmnElement[] = [];
    for (let owner = lane.parent?.parent; owner?.is('bpmn:Lane'); owner = owner.parent?.parent) {
      parents.unshift(owner);
    }
    return parents;
  }

  private static linkTo(end: BpmnElement, flow: BpmnElement): ElementLink {
    return { ...ElementFacts.refOf(end), flow: { ...ElementFacts.refOf(flow), ...new ElementFacts(flow).flowTraits() } };
  }

  answer(id: string): { text: string; view: ElementDetailData } {
    const element = this.document.tree.require(id);
    const view = this.of(element);
    return { text: new ElementDetailText(view).text(), view };
  }

  private of(element: BpmnElement): ElementDetailData {
    const { links, catches, messages } = this;
    const chain = this.scopeChain(element);
    const pool = links.poolOf(element);
    const host = element.is('bpmn:BoundaryEvent') ? element.peek<BpmnElement>('attachedToRef') : undefined;
    const isAnnotation = element.is('bpmn:TextAnnotation');
    const annotations = new ElementAnnotations(this.document);
    const attached = isAnnotation ? annotations.attachedTo(element) : [];
    const summary = new ElementSummaries(this.document).summary(element);
    return {
      kind: 'element',
      element: ElementFacts.refOf(element),
      ancestors: this.ancestors(element, chain),
      pool: pool && pool !== element ? ElementFacts.refOf(pool) : undefined,
      lane: this.lane(element),
      host: host && { ...ElementFacts.refOf(host), nonInterrupting: new ElementFacts(element).nonInterrupting() },
      ...this.ends(element),
      boundary: catches.boundaryOf(element),
      caughtBy: catches.around(chain),
      eventSubProcesses: catches.eventSubProcesses(element, chain),
      children: this.children(element),
      members: element.is('bpmn:Lane') ? element.list('flowNodeRef').map(ElementFacts.refOf) : undefined,
      message: messages.message(element),
      messageFlows: messages.flows(element),
      usedBy: messages.usedBy(element),
      data: new ElementData(this.document).links(element),
      annotations: isAnnotation ? [] : annotations.at(element).map(ElementAnnotations.textOf),
      attachedTo: attached.length ? attached.map(ElementFacts.refOf) : undefined,
      attrs: new ElementProperties(this.document).of(element, summary),
      extensions: new ExtensionLister().listAll(element),
    };
  }

  private scopeChain(element: BpmnElement): BpmnElement[] {
    const { scopes } = this.document;
    const chain: BpmnElement[] = [];
    for (let scope = scopes.scopeOf(element); scope; scope = scope.is('bpmn:SubProcess') ? scopes.scopeOf(scope) : undefined) {
      chain.push(scope);
    }
    return chain;
  }

  private ancestors(element: BpmnElement, chain: readonly BpmnElement[]): ElementRef[] {
    const collaboration = element.is('bpmn:MessageFlow') ? element.parent : undefined;
    return [...chain].reverse().map(ElementFacts.refOf).concat(collaboration ? [ElementFacts.refOf(collaboration)] : []);
  }

  private lane(element: BpmnElement): ElementLane | undefined {
    const found = element.is('bpmn:FlowNode') ? this.links.effectiveLane(element) : undefined;
    if (!found) {
      return undefined;
    }
    const parents = ElementDetail.parentLanes(found.lane).map(ElementFacts.refOf);
    return { ...ElementFacts.refOf(found.lane), via: found.via && ElementFacts.refOf(found.via), parents: parents.length ? parents : undefined };
  }

  private ends(element: BpmnElement): Pick<ElementDetailData, 'from' | 'to'> {
    if (element.is('bpmn:SequenceFlow') || element.is('bpmn:MessageFlow')) {
      return { from: this.flowEnd(element, 'sourceRef'), to: this.flowEnd(element, 'targetRef') };
    }
    if (!element.is('bpmn:FlowNode')) {
      return {};
    }
    const { flows } = this.document;
    const endOf = (flow: BpmnElement, property: string): ElementLink[] => {
      const end = flow.peek<BpmnElement>(property);
      return end ? [ElementDetail.linkTo(end, flow)] : [];
    };
    return { from: flows.incoming(element).flatMap((flow) => endOf(flow, 'sourceRef')), to: flows.outgoing(element).flatMap((flow) => endOf(flow, 'targetRef')) };
  }

  private flowEnd(flow: BpmnElement, property: 'sourceRef' | 'targetRef'): ElementLink[] {
    const end = flow.peek<BpmnElement>(property);
    if (!end) {
      return [];
    }
    const pool = flow.is('bpmn:MessageFlow') ? this.links.poolOf(end) : undefined;
    return [{ ...ElementDetail.linkTo(end, flow), pool: pool && pool !== end ? ElementFacts.refOf(pool) : undefined }];
  }

  private children(element: BpmnElement): ElementRef[] | undefined {
    const nodes = element.is('bpmn:SubProcess') ? new FlowOrder(this.document, element).ordered : [];
    return nodes.length ? nodes.map(ElementFacts.refOf) : undefined;
  }
}
