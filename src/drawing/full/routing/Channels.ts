export interface Channel {
  y: number;
  from: number;
  to: number;
}

export class Channels {
  readonly list: Channel[] = [];

  free(fromX: number, toX: number, base: number, step: number): number {
    const low = Math.min(fromX, toX);
    const high = Math.max(fromX, toX);
    let height = base;
    while (this.list.some((channel) => channel.y === height && channel.from <= high && low <= channel.to)) {
      height += step;
    }
    return height;
  }

  take(height: number, fromX: number, toX: number): void {
    this.list.push({ y: height, from: Math.min(fromX, toX), to: Math.max(fromX, toX) });
  }

  claim(fromX: number, toX: number, base: number, step: number): number {
    const height = this.free(fromX, toX, base, step);
    this.take(height, fromX, toX);
    return height;
  }

  lowest(): number {
    return Math.max(0, ...this.list.map((channel) => channel.y));
  }
}
