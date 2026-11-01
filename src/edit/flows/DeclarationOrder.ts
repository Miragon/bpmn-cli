import type { BpmnElement } from '../../model/index.js';

export class DeclarationOrder {
  static insertAfter(scope: BpmnElement, anchor: BpmnElement | undefined, ...elements: BpmnElement[]): void {
    DeclarationOrder.take(scope, elements);
    const position = anchor ? scope.list('flowElements').indexOf(anchor) : -1;
    scope.insert('flowElements', position === -1 ? scope.list('flowElements').length : position + 1, ...elements);
  }

  static insertBefore(scope: BpmnElement, anchor: BpmnElement | undefined, ...elements: BpmnElement[]): void {
    DeclarationOrder.take(scope, elements);
    const position = anchor ? scope.list('flowElements').indexOf(anchor) : -1;
    scope.insert('flowElements', position === -1 ? scope.list('flowElements').length : position, ...elements);
  }

  static lastFlowOf(scope: BpmnElement, source: BpmnElement): BpmnElement | undefined {
    return [...scope.list('flowElements')].reverse().find((element) => element.is('bpmn:SequenceFlow') && element.get<BpmnElement | undefined>('sourceRef') === source);
  }

  private static take(scope: BpmnElement, elements: readonly BpmnElement[]): void {
    for (const element of elements) {
      scope.remove('flowElements', element);
    }
  }
}
