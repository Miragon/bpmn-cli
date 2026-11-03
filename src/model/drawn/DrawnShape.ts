import type { BpmnElement } from '../document/BpmnElement.js';
import type { Box } from '../geometry/Box.js';

export type ShapeDrawing = Pick<DrawnShape, 'id' | 'el' | 'bounds'> & Partial<Pick<DrawnShape, 'expanded' | 'label'>>;

export class DrawnShape {
  readonly isPool: boolean;
  readonly isLane: boolean;
  readonly isBoundary: boolean;
  readonly isFrame: boolean;
  readonly hostId: string | undefined;

  constructor(readonly id: string, readonly el: BpmnElement, readonly bounds: Box, readonly expanded: boolean, readonly label: Box | undefined) {
    this.isPool = el.is('bpmn:Participant');
    this.isLane = el.is('bpmn:Lane');
    this.isBoundary = el.is('bpmn:BoundaryEvent');
    this.isFrame = this.isPool || this.isLane || (expanded && el.is('bpmn:SubProcess'));
    this.hostId = el.peek<BpmnElement>('attachedToRef')?.id;
  }

  static isWithin(inner: Box, outer: Box): boolean {
    return inner.x >= outer.x && inner.y >= outer.y && inner.right <= outer.right && inner.bottom <= outer.bottom;
  }

  isAttachedTo(other: DrawnShape): boolean {
    return this.isBoundary && this.hostId === other.id;
  }

  get isLabelledOutside(): boolean {
    return ['bpmn:Event', 'bpmn:Gateway', 'bpmn:DataObjectReference', 'bpmn:DataStoreReference'].some((type) => this.el.is(type));
  }
}
