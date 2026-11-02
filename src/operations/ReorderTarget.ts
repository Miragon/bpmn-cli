import type { BpmnDocument } from '../model/index.js';
import type { OrderOperation } from './model/OrderOperationDefinition.js';

export class ReorderTarget {
  constructor(
    private readonly document: BpmnDocument,
    private readonly operation: OrderOperation,
  ) {}

  ordersLanes(): boolean {
    return Boolean(this.operation.lanes?.length) || this.firstFlowIs('bpmn:Lane');
  }

  ordersPools(): boolean {
    return Boolean(this.operation.pools?.length) || Boolean(this.document.tree.byId(this.operation.id)?.is('bpmn:Collaboration')) || this.firstFlowIs('bpmn:Participant');
  }

  ordersBands(): boolean {
    return this.ordersLanes() || this.ordersPools();
  }

  private firstFlowIs(type: string): boolean {
    const first = this.operation.flows?.[0];
    return first !== undefined && Boolean(this.document.tree.byId(first)?.is(type));
  }
}
