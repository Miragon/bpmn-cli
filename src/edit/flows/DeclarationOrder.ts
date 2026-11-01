import type { BpmnElement } from '../../model/index.js';

export class DeclarationOrder {
  constructor(private readonly scope: BpmnElement) {}

  insertAfter(anchor: BpmnElement | undefined, ...elements: BpmnElement[]): void {
    this.take(elements);
    const position = anchor ? this.scope.list('flowElements').indexOf(anchor) : -1;
    this.scope.insert('flowElements', position === -1 ? this.scope.list('flowElements').length : position + 1, ...elements);
  }

  insertBefore(anchor: BpmnElement | undefined, ...elements: BpmnElement[]): void {
    this.take(elements);
    const position = anchor ? this.scope.list('flowElements').indexOf(anchor) : -1;
    this.scope.insert('flowElements', position === -1 ? this.scope.list('flowElements').length : position, ...elements);
  }

  lastFlowOf(source: BpmnElement): BpmnElement | undefined {
    return [...this.scope.list('flowElements')].reverse().find((element) => element.is('bpmn:SequenceFlow') && element.get<BpmnElement | undefined>('sourceRef') === source);
  }

  private take(elements: readonly BpmnElement[]): void {
    for (const element of elements) {
      this.scope.remove('flowElements', element);
    }
  }
}
