import type { Box, BpmnElement, Point } from '../../../model/index.js';
import type { ScopeLayout } from './GNode.js';

export interface PoolLayout {
  participant: BpmnElement;
  process?: BpmnElement | undefined;
  scope?: ScopeLayout | undefined;
  box: Box;
  origin: Point;
  planeElements?: BpmnElement[] | undefined;
}

export class PoolLayouts {
  readonly list: PoolLayout[] = [];

  of(element: BpmnElement): PoolLayout | undefined {
    if (element.is('bpmn:Participant')) {
      return this.list.find((pool) => pool.participant === element);
    }
    let ancestor = element.parent;
    while (ancestor && !ancestor.is('bpmn:Process')) {
      ancestor = ancestor.parent;
    }
    return ancestor && this.list.find((pool) => pool.process === ancestor);
  }
}
