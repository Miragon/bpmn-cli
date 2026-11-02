import type { BpmnElement } from '../document/BpmnElement.js';
import { DiagramIndex } from '../diagram/DiagramIndex.js';

export interface HiddenEnd {
  end: BpmnElement;
  subProcess: BpmnElement;
}

type CollapsedCheck = (subProcess: BpmnElement) => boolean;

export class DataAssociationEnds {
  constructor(private readonly association: BpmnElement) {}

  static isInside(element: BpmnElement, scope: BpmnElement): boolean {
    for (let ancestor = element.parent; ancestor; ancestor = ancestor.parent) {
      if (ancestor === scope) {
        return true;
      }
    }
    return false;
  }

  static collapsedAround(end: BpmnElement, other: BpmnElement, isCollapsed: CollapsedCheck): BpmnElement | undefined {
    let outermost: BpmnElement | undefined;
    for (let ancestor = end.parent; ancestor; ancestor = ancestor.parent) {
      if (DiagramIndex.isSubProcess(ancestor) && !DataAssociationEnds.isInside(other, ancestor) && isCollapsed(ancestor)) {
        outermost = ancestor;
      }
    }
    return outermost;
  }

  get node(): BpmnElement | undefined {
    return this.association.parent;
  }

  get data(): BpmnElement | undefined {
    const data = this.association.is('bpmn:DataInputAssociation') ? this.association.list('sourceRef')[0] : this.association.get<BpmnElement | undefined>('targetRef');
    return data?.is('bpmn:DataObjectReference') || data?.is('bpmn:DataStoreReference') ? data : undefined;
  }

  hiddenEnd(isCollapsed: CollapsedCheck): HiddenEnd | undefined {
    const { node, data } = this;
    if (!node || !data) {
      return undefined;
    }
    for (const [end, other] of [[node, data], [data, node]] as const) {
      const subProcess = DataAssociationEnds.collapsedAround(end, other, isCollapsed);
      if (subProcess) {
        return { end, subProcess };
      }
    }
    return undefined;
  }
}
