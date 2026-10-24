/** Width of the columns XIndex sorts its items into, and the most columns a range covers (a wider one is everywhere). */
const X_BUCKET = 128;
const X_COLUMNS = 4096;

/**
 * Items (boxes, segments) found by the x range they cover: `near(lo, hi)` gives each item whose range meets
 * [lo, hi] once, maybe some more (those in the same columns of X_BUCKET px), in no particular order. The router's
 * tests count only what lies there (crossings, cut shapes), so over these items they count as over all of them.
 */
export class XIndex<T> {
  private readonly columns = new Map<number, number[]>();
  /** items whose range is not finite or very wide: met by every query */
  private readonly everywhere: number[] = [];
  private readonly items: T[] = [];
  private readonly seen: number[] = [];
  private query = 0;

  /** how many items were added */
  get size(): number {
    return this.items.length;
  }

  add(item: T, lo: number, hi: number): void {
    const id = this.items.length;
    this.items.push(item);
    this.seen.push(0);
    const first = Math.floor(lo / X_BUCKET), last = Math.floor(hi / X_BUCKET);
    if (!(last - first <= X_COLUMNS)) {
      this.everywhere.push(id);
      return;
    }
    for (let c = first; c <= last; c++) {
      const column = this.columns.get(c);
      if (column) column.push(id);
      else this.columns.set(c, [id]);
    }
  }

  /**
   * Calls `fn` on what near(lo, hi) gives (with its id: the items count from 0 in the order they were added; only
   * those from id `from` on), without collecting it, until `fn` returns true (then true). `fn` must not query this
   * index itself.
   */
  each(lo: number, hi: number, fn: (item: T, id: number) => boolean | void, from = 0): boolean {
    const first = Math.floor(lo / X_BUCKET), last = Math.floor(hi / X_BUCKET);
    if (!(last - first <= X_COLUMNS)) return this.items.some((item, id) => id >= from && fn(item, id) === true);
    const { items, seen } = this;
    const q = ++this.query;
    for (let c = first - 1; c <= last; c++) {
      const ids = c < first ? this.everywhere : this.columns.get(c);
      if (!ids) continue;
      // the ids of a column ascend (they are added in order): start at the first from `from` on
      let k = 0;
      for (let hiK = from ? ids.length : 0; k < hiK; ) {
        const mid = (k + hiK) >> 1;
        if (ids[mid]! < from) k = mid + 1;
        else hiK = mid;
      }
      for (; k < ids.length; k++) {
        const id = ids[k]!;
        if (seen[id] === q) continue;
        seen[id] = q;
        if (fn(items[id]!, id) === true) return true;
      }
    }
    return false;
  }

  near(lo: number, hi: number): T[] {
    const first = Math.floor(lo / X_BUCKET), last = Math.floor(hi / X_BUCKET);
    if (!(last - first <= X_COLUMNS)) return [...this.items];
    const { items, seen } = this;
    const out: T[] = [];
    const q = ++this.query;
    for (let c = first - 1; c <= last; c++) {
      const ids = c < first ? this.everywhere : this.columns.get(c);
      if (!ids) continue;
      for (const id of ids) {
        if (seen[id] === q) continue;
        seen[id] = q;
        out.push(items[id]!);
      }
    }
    return out;
  }
}
