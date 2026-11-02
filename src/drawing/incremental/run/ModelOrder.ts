import { DiagramIndex, type BpmnElement } from '../../../model/index.js';

export class ModelOrder {
  constructor(private readonly definitions: BpmnElement) {}

  private static lanesOf(laneSets: readonly BpmnElement[]): BpmnElement[] {
    return laneSets.flatMap((laneSet) => laneSet.list('lanes').flatMap((lane) => {
      const children = lane.peek<BpmnElement>('childLaneSet');
      return [lane, ...(children ? ModelOrder.lanesOf([children]) : [])];
    }));
  }

  private static scopeElements(scope: BpmnElement): BpmnElement[] {
    const flowElements = scope.list('flowElements').flatMap((element) => [
      element,
      ...element.list('dataInputAssociations'),
      ...element.list('dataOutputAssociations'),
      ...(DiagramIndex.isSubProcess(element) ? ModelOrder.scopeElements(element) : []),
    ]);
    return [...flowElements, ...scope.list('artifacts')];
  }

  elements(): BpmnElement[] {
    const roots = this.definitions.list('rootElements');
    const collaborations = roots.filter((root) => root.is('bpmn:Collaboration')).flatMap((root) => [...root.list('participants'), ...root.list('messageFlows'), ...root.list('artifacts')]);
    const processes = roots.filter((root) => root.is('bpmn:Process')).flatMap((root) => [...ModelOrder.lanesOf(root.list('laneSets')), ...ModelOrder.scopeElements(root)]);
    return [...collaborations, ...processes];
  }
}
