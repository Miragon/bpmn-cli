import type { GNode } from '../../drawing/types.js';

/** The x positions on one border (bottom or top) of each node that flows already take; `out`: a flow leaving there. */
export class BorderSlots {
  private readonly slots = new Map<GNode, Array<{ x: number; out: boolean }>>();

  /** For a gateway entry only an exit counts: a join's entries share the vertex. */
  taken(n: GNode, x: number, entry = false): boolean {
    return (this.slots.get(n) ?? []).some((u) => Math.abs(u.x - x) < 1 && (u.out || !entry || n.kind !== 'gateway'));
  }

  take(n: GNode, x: number, out: boolean): void {
    const list = this.slots.get(n) ?? [];
    list.push({ x, out });
    this.slots.set(n, list);
  }
}
