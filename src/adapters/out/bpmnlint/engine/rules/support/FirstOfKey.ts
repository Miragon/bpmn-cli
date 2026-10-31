/** The first item of each key, in the order the items come: a later item with the key repeats it. */
export class FirstOfKey<T> {
  private readonly firsts = new Map<string, T>();

  /** The first item of `key` when `item` repeats it, else undefined, and `item` is the first. */
  repeats(key: string, item: T): T | undefined {
    const first = this.firsts.get(key);
    if (first === undefined) this.firsts.set(key, item);
    return first;
  }
}
