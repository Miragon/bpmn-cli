export class Interval {
  constructor(
    readonly low: number,
    readonly high: number,
  ) {}

  clamp(value: number): number {
    return Math.min(this.high, Math.max(this.low, value));
  }
}
