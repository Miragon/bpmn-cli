/**
 * One element is not a convention: a learned rule needs two ids that follow it.
 * In a mostly prefixed file one id is enough for the prefix of its own kind and family.
 */
export const MIN_EVIDENCE = 2;

export class Tally<TKey> {
  readonly counts = new Map<TKey, number>();
  add(key: TKey, amount = 1): void {
    this.counts.set(key, (this.counts.get(key) ?? 0) + amount);
  }
  get(key: TKey): number {
    return this.counts.get(key) ?? 0;
  }
  get total(): number {
    let total = 0;
    for (const count of this.counts.values()) total += count;
    return total;
  }
  /**
   * The most frequent key with at least `min` votes. A tie goes to `prefers`, else to the first
   * counted; flow votes pass `prefers` so document order never tips them.
   */
  top(min = MIN_EVIDENCE, prefers?: (first: TKey, second: TKey) => boolean): TKey | undefined {
    let best: TKey | undefined;
    let bestCount = 0;
    for (const [key, count] of this.counts) {
      if (count > bestCount || (count === bestCount && best !== undefined && prefers?.(key, best))) {
        best = key;
        bestCount = count;
      }
    }
    return bestCount >= min ? best : undefined;
  }
}
