import type { Doc } from '../document/Doc.js';
import { is } from '../document/utils/moddle.js';
import type { ReorderElements } from './types.js';

/** What an `order` command reorders: the outgoing flows of a node, the lanes of a pool or lane, or the pools of a collaboration. */
export class ReorderTarget {
  constructor(
    private readonly doc: Doc,
    private readonly command: ReorderElements,
  ) {}

  ordersLanes(): boolean {
    if (this.command.lanes?.length) return true;
    const first = this.command.flows?.[0];
    return !!first && is(this.doc.get(first), 'bpmn:Lane');
  }

  ordersPools(): boolean {
    if (this.command.pools?.length) return true;
    if (is(this.doc.get(this.command.id), 'bpmn:Collaboration')) return true;
    const first = this.command.flows?.[0];
    return !!first && is(this.doc.get(first), 'bpmn:Participant');
  }

  /** Lanes and pools are bands of the drawing: the diagram follows their new order. */
  ordersBands(): boolean {
    return this.ordersLanes() || this.ordersPools();
  }
}
