/** a range wider than X_COLUMNS buckets is treated as everywhere */
const X_BUCKET = 128;
const X_COLUMNS = 4096;

/**
 * Finds boxes and segments by the x range they cover. `near` may return extra items from the
 * same buckets; callers test geometry anyway, so the result equals a scan over all items.
 */
export class XIndex<TItem> {
  private readonly columns = new Map<number, number[]>();
  private readonly everywhere: number[] = [];
  private readonly items: TItem[] = [];
  private readonly seen: number[] = [];
  private query = 0;

  get size(): number {
    return this.items.length;
  }

  add(item: TItem, lo: number, hi: number): void {
    const id = this.items.length;
    this.items.push(item);
    this.seen.push(0);
    const first = Math.floor(lo / X_BUCKET), last = Math.floor(hi / X_BUCKET);
    if (!(last - first <= X_COLUMNS)) {
      this.everywhere.push(id);
      return;
    }
    for (let columnIndex = first; columnIndex <= last; columnIndex++) {
      const column = this.columns.get(columnIndex);
      if (column) {
        column.push(id);
      } else {
        this.columns.set(columnIndex, [id]);
      }
    }
  }

  /** Ids count from 0 in insertion order. `fn` must not query this index itself. */
  each(lo: number, hi: number, fn: (item: TItem, id: number) => boolean | void, from = 0): boolean {
    const first = Math.floor(lo / X_BUCKET), last = Math.floor(hi / X_BUCKET);
    if (!(last - first <= X_COLUMNS)) {
      return this.items.some((item, id) => id >= from && fn(item, id) === true);
    }
    const { items, seen } = this;
    const queryId = ++this.query;
    for (let columnIndex = first - 1; columnIndex <= last; columnIndex++) {
      const ids = columnIndex < first ? this.everywhere : this.columns.get(columnIndex);
      if (!ids) continue;
      let position = 0;
      for (let hiK = from ? ids.length : 0; position < hiK; ) {
        const mid = (position + hiK) >> 1;
        if (ids[mid]! < from) {
          position = mid + 1;
        } else {
          hiK = mid;
        }
      }
      for (; position < ids.length; position++) {
        const id = ids[position]!;
        if (seen[id] === queryId) continue;
        seen[id] = queryId;
        if (fn(items[id]!, id) === true) return true;
      }
    }
    return false;
  }

  near(lo: number, hi: number): TItem[] {
    const first = Math.floor(lo / X_BUCKET), last = Math.floor(hi / X_BUCKET);
    if (!(last - first <= X_COLUMNS)) return [...this.items];
    const { items, seen } = this;
    const out: TItem[] = [];
    const queryId = ++this.query;
    for (let columnIndex = first - 1; columnIndex <= last; columnIndex++) {
      const ids = columnIndex < first ? this.everywhere : this.columns.get(columnIndex);
      if (!ids) continue;
      for (const id of ids) {
        if (seen[id] === queryId) continue;
        seen[id] = queryId;
        out.push(items[id]!);
      }
    }
    return out;
  }
}
