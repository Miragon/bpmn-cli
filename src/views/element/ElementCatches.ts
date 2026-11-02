import { Kinds, type BpmnDocument, type BpmnElement } from '../../model/index.js';
import type { ElementRef } from '../lines/index.js';
import { ElementFacts } from '../facts/index.js';

export interface ElementCatch extends ElementRef {
  trigger?: string | undefined;
  nonInterrupting?: boolean | undefined;
  on?: ElementRef | undefined;
  to?: ElementRef[] | undefined;
}

export interface EventSubProcessCatch extends ElementRef {
  in: ElementRef;
  start?: ElementCatch | undefined;
}

export class ElementCatches {
  constructor(private readonly document: BpmnDocument) {}

  boundaryOf(element: BpmnElement): ElementCatch[] {
    return element.is('bpmn:Activity') ? this.document.scopes.boundaryEventsOf(element).map((event) => this.catchOf(event)) : [];
  }

  around(chain: readonly BpmnElement[]): ElementCatch[] {
    return chain.filter((scope) => scope.is('bpmn:SubProcess')).flatMap((scope) => this.boundaryOf(scope));
  }

  eventSubProcesses(element: BpmnElement, chain: readonly BpmnElement[]): EventSubProcessCatch[] {
    return chain.flatMap((scope) => {
      const hosts = this.document.scopes.flowNodes(scope).filter((node) => Kinds.isEventSubProcess(node) && node !== element && !chain.includes(node));
      return hosts.map((host) => {
        const start = this.document.scopes.flowNodes(host).find((child) => child.is('bpmn:StartEvent'));
        return { ...new ElementFacts(host).ref(), in: new ElementFacts(scope).ref(), start: start && this.catchOf(start) };
      });
    });
  }

  private catchOf(event: BpmnElement): ElementCatch {
    const facts = new ElementFacts(event);
    const host = event.is('bpmn:BoundaryEvent') ? event.peek<BpmnElement>('attachedToRef') : undefined;
    const targets = this.document.flows.outgoing(event).flatMap((flow) => flow.peek<BpmnElement>('targetRef') ?? []);
    return {
      ...facts.ref(),
      trigger: facts.trigger(),
      nonInterrupting: facts.nonInterrupting(),
      on: host && new ElementFacts(host).ref(),
      to: targets.length ? targets.map((target) => new ElementFacts(target).ref()) : undefined,
    };
  }
}
