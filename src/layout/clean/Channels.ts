/** A horizontal run a flow takes at height `y` between `from` and `to`. */
export interface Channel {
  y: number;
  from: number;
  to: number;
}

/** The horizontal channels loops and back flows of a scope run in: no two share a height where they overlap. */
export class Channels {
  readonly list: Channel[] = [];

  /** The first height from `base`, `step` apart, that no channel over the same span holds. */
  free(fromX: number, toX: number, base: number, step: number): number {
    const lo = Math.min(fromX, toX), hi = Math.max(fromX, toX);
    let y = base;
    while (this.list.some((c) => c.y === y && c.from <= hi && lo <= c.to)) y += step;
    return y;
  }

  take(y: number, fromX: number, toX: number): void {
    this.list.push({ y, from: Math.min(fromX, toX), to: Math.max(fromX, toX) });
  }

  claim(fromX: number, toX: number, base: number, step: number): number {
    const y = this.free(fromX, toX, base, step);
    this.take(y, fromX, toX);
    return y;
  }

  lowest(): number {
    return Math.max(0, ...this.list.map((c) => c.y));
  }
}
