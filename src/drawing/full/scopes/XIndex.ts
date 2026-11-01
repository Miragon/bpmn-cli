export class XIndex<TItem> {
  private static readonly BUCKET = 128;
  private static readonly MAX_COLUMNS = 4096;

  private readonly columns = new Map<number, number[]>();
  private readonly everywhere: number[] = [];
  private readonly items: TItem[] = [];
  private readonly seen: number[] = [];
  private query = 0;

  private static bucketOf(x: number): number {
    return Math.floor(x / XIndex.BUCKET);
  }

  private static isTooWide(first: number, last: number): boolean {
    return !(last - first <= XIndex.MAX_COLUMNS);
  }

  private static firstAtOrAfter(ids: readonly number[], from: number): number {
    let position = 0;
    for (let limit = from ? ids.length : 0; position < limit; ) {
      const middle = (position + limit) >> 1;
      if (ids[middle]! < from) {
        position = middle + 1;
      } else {
        limit = middle;
      }
    }
    return position;
  }

  get size(): number {
    return this.items.length;
  }

  add(item: TItem, low: number, high: number): void {
    const id = this.items.length;
    this.items.push(item);
    this.seen.push(0);
    const first = XIndex.bucketOf(low);
    const last = XIndex.bucketOf(high);
    if (XIndex.isTooWide(first, last)) {
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

  each(low: number, high: number, visit: (item: TItem, id: number) => boolean | void, from = 0): boolean {
    const first = XIndex.bucketOf(low);
    const last = XIndex.bucketOf(high);
    if (XIndex.isTooWide(first, last)) {
      return this.items.some((item, id) => id >= from && visit(item, id) === true);
    }
    const queryId = ++this.query;
    for (let columnIndex = first - 1; columnIndex <= last; columnIndex++) {
      const ids = columnIndex < first ? this.everywhere : this.columns.get(columnIndex);
      if (ids && this.visitColumn(ids, queryId, visit, from)) {
        return true;
      }
    }
    return false;
  }

  near(low: number, high: number): TItem[] {
    const found: TItem[] = [];
    this.each(low, high, (item) => {
      found.push(item);
    });
    return found;
  }

  private visitColumn(ids: readonly number[], queryId: number, visit: (item: TItem, id: number) => boolean | void, from: number): boolean {
    const { items, seen } = this;
    for (let position = XIndex.firstAtOrAfter(ids, from); position < ids.length; position++) {
      const id = ids[position]!;
      if (seen[id] !== queryId) {
        seen[id] = queryId;
        if (visit(items[id]!, id) === true) {
          return true;
        }
      }
    }
    return false;
  }
}
