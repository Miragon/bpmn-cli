import type { BpmnDocument, BpmnElement } from '../../model/index.js';
import { ElementLinks } from './ElementLinks.js';

export class ElementContainer {
  readonly element: BpmnElement;
  readonly process: BpmnElement;

  private readonly links: ElementLinks;

  constructor(
    document: BpmnDocument,
    id: string,
  ) {
    this.links = new ElementLinks(document);
    const named = document.tree.require(id, ['bpmn:Process', 'bpmn:SubProcess', 'bpmn:Participant', 'bpmn:Lane'], 'container');
    this.element = named.is('bpmn:Lane') ? named : document.scopes.requireScope(id);
    this.process = document.scopes.processOf(this.element)!;
  }

  get isLane(): boolean {
    return this.element.is('bpmn:Lane');
  }

  holds(element: BpmnElement): boolean {
    if (this.isLane) {
      return this.lanesOf(element).includes(this.element);
    }
    for (let ancestor = element.parent; ancestor; ancestor = ancestor.parent) {
      if (ancestor === this.element) {
        return true;
      }
    }
    return false;
  }

  private lanesOf(element: BpmnElement): BpmnElement[] {
    const anchor = element.is('bpmn:SequenceFlow') ? element.peek<BpmnElement>('sourceRef') : element;
    const lane = anchor?.is('bpmn:FlowNode') ? this.links.effectiveLane(anchor)?.lane : undefined;
    const chain: BpmnElement[] = [];
    for (let current = lane; current && !current.is('bpmn:Process'); current = current.parent) {
      if (current.is('bpmn:Lane')) {
        chain.push(current);
      }
    }
    return chain;
  }
}
