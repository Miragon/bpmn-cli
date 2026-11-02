import type { BpmnDocument, BpmnElement } from '../../model/index.js';
import type { ElementRef, FlagSource, OutgoingFlow } from '../lines/index.js';
import { ElementFacts } from './ElementFacts.js';

export interface ElementSummary extends ElementRef, FlagSource {
  outgoing: OutgoingFlow[];
}

export class ElementSummaries {
  constructor(private readonly document: BpmnDocument) {}

  summary(element: BpmnElement, { zeebe = true }: { zeebe?: boolean } = {}): ElementSummary {
    const facts = new ElementFacts(element);
    const lane = element.is('bpmn:FlowNode') && !element.is('bpmn:BoundaryEvent') ? this.document.scopes.laneOf(element) : undefined;
    return {
      ...facts.ref(),
      trigger: facts.trigger(),
      nonInterrupting: facts.nonInterrupting(),
      documentation: facts.documentation(),
      props: facts.props({ zeebe }),
      lane: lane && new ElementFacts(lane).ref(),
      outgoing: this.document.flows.outgoing(element).map((flow) => new ElementFacts(flow).outgoingFlow()),
    };
  }
}
