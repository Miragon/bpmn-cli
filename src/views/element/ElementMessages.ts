import { type BpmnDocument, type BpmnElement } from '../../model/index.js';
import { ElementFacts, type ElementLinks, type PartnerFlow } from '../facts/index.js';
import type { ElementRef } from '../lines/index.js';

export interface ElementMessage extends ElementRef {
  correlationKey?: string | undefined;
}

export class ElementMessages {
  private static readonly USER_PROPERTIES: ReadonlyArray<[string, string]> = [
    ['bpmn:Message', 'messageRef'],
    ['bpmn:Signal', 'signalRef'],
    ['bpmn:Error', 'errorRef'],
    ['bpmn:Escalation', 'escalationRef'],
  ];

  constructor(
    private readonly document: BpmnDocument,
    private readonly links: ElementLinks,
  ) {}

  private static messageDefinition(element: BpmnElement): BpmnElement | undefined {
    return element.list('eventDefinitions').find((definition) => definition.is('bpmn:MessageEventDefinition'));
  }

  private static messageOf(element: BpmnElement): BpmnElement | undefined {
    const carrier = element.is('bpmn:SendTask') || element.is('bpmn:ReceiveTask') || element.is('bpmn:MessageFlow') ? element : ElementMessages.messageDefinition(element);
    return carrier?.peek<BpmnElement>('messageRef');
  }

  private static direction(element: BpmnElement): 'in' | 'out' | undefined {
    if (element.is('bpmn:ReceiveTask') || (ElementMessages.messageDefinition(element) && element.is('bpmn:CatchEvent'))) {
      return 'in';
    }
    return element.is('bpmn:SendTask') || (ElementMessages.messageDefinition(element) && element.is('bpmn:ThrowEvent')) ? 'out' : undefined;
  }

  message(element: BpmnElement): ElementMessage | undefined {
    const message = ElementMessages.messageOf(element);
    return message && { ...new ElementFacts(message).ref(), correlationKey: new ElementFacts(message).correlationKey() };
  }

  flows(element: BpmnElement): PartnerFlow[] {
    return element.is('bpmn:MessageFlow') ? [] : [...this.links.partnerFlows(element), ...this.poolFlows(element)];
  }

  usedBy(root: BpmnElement): ElementRef[] | undefined {
    const property = ElementMessages.USER_PROPERTIES.find(([type]) => root.is(type))?.[1];
    if (!property) {
      return undefined;
    }
    const users = new Set<BpmnElement>();
    for (const element of this.document.tree.walk(this.document.tree.definitions, { bpmnOnly: true })) {
      const user = element.is('bpmn:EventDefinition') ? element.parent : element;
      if (element.peek<BpmnElement>(property) === root && user) {
        users.add(user);
      }
    }
    return users.size ? [...users].map((user) => new ElementFacts(user).ref()) : undefined;
  }

  private poolFlows(element: BpmnElement): PartnerFlow[] {
    const direction = ElementMessages.direction(element);
    const message = ElementMessages.messageOf(element);
    const pool = this.links.poolOf(element);
    if (!direction || !message || !pool || pool === element) {
      return [];
    }
    const end = direction === 'in' ? 'targetRef' : 'sourceRef';
    const atPool = this.document.flows.messageFlows().filter((flow) => flow.peek<BpmnElement>(end) === pool && ElementMessages.carries(flow, message));
    return atPool.map((flow) => ({ ...this.links.partnerFlow(flow, direction), at: pool.id }));
  }

  private static carries(flow: BpmnElement, message: BpmnElement): boolean {
    const reference = flow.peek<BpmnElement>('messageRef');
    return reference ? reference === message : !!message.name && flow.name === message.name;
  }
}
