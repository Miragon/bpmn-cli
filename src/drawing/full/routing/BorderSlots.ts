import type { GNode } from '../scopes/GNode.js';

export class BorderSlots {
  private readonly slots = new Map<GNode, Array<{ x: number; out: boolean }>>();

  taken(node: GNode, x: number, entry = false): boolean {
    return (this.slots.get(node) ?? []).some((slot) => Math.abs(slot.x - x) < 1 && (slot.out || !entry || node.kind !== 'gateway'));
  }

  take(node: GNode, x: number, out: boolean): void {
    const slots = this.slots.get(node) ?? [];
    slots.push({ x, out });
    this.slots.set(node, slots);
  }
}
