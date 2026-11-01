export class Samples {
  constructor(private readonly values: readonly number[]) {}

  median(): number | undefined {
    if (!this.values.length) {
      return undefined;
    }
    const sorted = [...this.values].sort((first, second) => first - second);
    const middle = sorted.length >> 1;
    return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
  }
}
