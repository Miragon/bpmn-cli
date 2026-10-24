/**
 * One element is not a convention: a learned rule needs two ids that follow
 * it. In a file whose ids are mostly prefixed (at least three, at least half
 * of them), one id is enough for the prefix of its own kind (`End_1` for the
 * next end event) and of its family.
 */
export const MIN_EVIDENCE = 2;

export class Tally<K> {
  readonly counts = new Map<K, number>();
  add(k: K, n = 1): void {
    this.counts.set(k, (this.counts.get(k) ?? 0) + n);
  }
  get(k: K): number {
    return this.counts.get(k) ?? 0;
  }
  get total(): number {
    let t = 0;
    for (const v of this.counts.values()) t += v;
    return t;
  }
  /**
   * The most frequent key with at least `min` occurrences. A tie goes to the
   * key `prefers` puts before the other (the flow votes: never document
   * order, so a flow a move declares elsewhere tips nothing), else to the
   * first one counted.
   */
  top(min = MIN_EVIDENCE, prefers?: (a: K, b: K) => boolean): K | undefined {
    let best: K | undefined;
    let n = 0;
    for (const [k, v] of this.counts) {
      if (v > n || (v === n && best !== undefined && prefers?.(k, best))) {
        best = k;
        n = v;
      }
    }
    return n >= min ? best : undefined;
  }
}
