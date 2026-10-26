import type { GNode } from '../../di/types.js';

/** The x positions on one border (bottom or top) of each node that flows already take; `out`: a flow leaving there. */
export class BorderSlots {
  private readonly slots = new Map<GNode, Array<{ x: number; out: boolean }>>();

  /** For a gateway entry only an exit counts: a join's entries share the vertex. */
  taken(node: GNode, left: number, entry = false): boolean {
    return (this.slots.get(node) ?? []).some((slot) => Math.abs(slot.x - left) < 1 && (slot.out || !entry || node.kind !== 'gateway'));
  }

  take(node: GNode, left: number, out: boolean): void {
    const list = this.slots.get(node) ?? [];
    list.push({ x: left, out });
    this.slots.set(node, list);
  }
}
