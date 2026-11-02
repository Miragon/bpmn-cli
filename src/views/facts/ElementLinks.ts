import { ElementText, type BpmnDocument, type BpmnElement } from '../../model/index.js';
import type { ElementRef, MessageFlowEnds } from '../lines/index.js';
import { ElementFacts } from './ElementFacts.js';

export interface PartnerFlow extends ElementRef {
  direction: 'in' | 'out';
  message?: string | undefined;
  partner: ElementRef;
  pool?: ElementRef | undefined;
  at?: string | undefined;
}

export class ElementLinks {
  constructor(private readonly document: BpmnDocument) {}

  private static messageText(message: BpmnElement | undefined): string | undefined {
    return message && (message.name || ElementText.shownId(message));
  }

  scopesWithin(process: BpmnElement): BpmnElement[] {
    return [...this.document.tree.walk(process)].filter((element) => element.is('bpmn:Process') || element.is('bpmn:SubProcess'));
  }

  poolOf(element: BpmnElement): BpmnElement | undefined {
    if (element.is('bpmn:Participant')) {
      return element;
    }
    const process = this.document.scopes.processOf(element);
    return process && this.document.flows.participantOf(process);
  }

  partnerFlows(element: BpmnElement): PartnerFlow[] {
    return this.document.flows.messageFlows().flatMap((flow) => {
      const source = flow.peek<BpmnElement>('sourceRef') === element;
      const target = flow.peek<BpmnElement>('targetRef') === element;
      return source || target ? [this.partnerFlow(flow, source ? 'out' : 'in')] : [];
    });
  }

  partnerFlow(flow: BpmnElement, direction: 'in' | 'out'): PartnerFlow {
    const partner = flow.peek<BpmnElement>(direction === 'out' ? 'targetRef' : 'sourceRef');
    const pool = partner && this.poolOf(partner);
    return {
      ...ElementFacts.refOf(flow),
      direction,
      message: ElementLinks.messageText(flow.peek<BpmnElement>('messageRef')),
      partner: ElementFacts.refOf(partner),
      pool: pool && pool !== partner ? ElementFacts.refOf(pool) : undefined,
    };
  }

  messageFlowEnds(flow: BpmnElement): MessageFlowEnds & ElementRef {
    return { ...ElementFacts.refOf(flow), source: ElementFacts.refOf(flow.peek<BpmnElement>('sourceRef')), target: ElementFacts.refOf(flow.peek<BpmnElement>('targetRef')), message: ElementLinks.messageText(flow.peek<BpmnElement>('messageRef')) };
  }

  effectiveLane(element: BpmnElement): { lane: BpmnElement; via?: BpmnElement } | undefined {
    const { scopes } = this.document;
    const own = scopes.laneOf(element);
    if (own) {
      return { lane: own };
    }
    const host = element.is('bpmn:BoundaryEvent') ? element.peek<BpmnElement>('attachedToRef') : undefined;
    const hosted = host && this.effectiveLane(host);
    if (host && hosted) {
      return { lane: hosted.lane, via: hosted.via ?? host };
    }
    for (let scope = scopes.scopeOf(element); scope?.is('bpmn:SubProcess'); scope = scopes.scopeOf(scope)) {
      const lane = scopes.laneOf(scope);
      if (lane) {
        return { lane, via: scope };
      }
    }
    return undefined;
  }
}
