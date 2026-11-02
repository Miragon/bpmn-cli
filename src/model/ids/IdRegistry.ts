import { IdWords } from './IdWords.js';

export class IdRegistry {
  private readonly used = new Set<string>();

  constructor(existing: Iterable<string> = []) {
    for (const id of existing) {
      this.used.add(id);
    }
  }

  has(id: string): boolean {
    return this.used.has(id);
  }

  claim(id: string): void {
    this.used.add(id);
  }

  release(id: string): void {
    this.used.delete(id);
  }

  values(): IterableIterator<string> {
    return this.used.values();
  }

  bodyTaken(id: string): boolean {
    const at = id.indexOf('_');
    if (at === -1) {
      return false;
    }
    const tail = id.slice(at);
    for (const other of this.used) {
      if (other !== id && other.endsWith(tail) && IdWords.PREFIXED.test(other) && other.indexOf('_') === other.length - tail.length) {
        return true;
      }
    }
    return false;
  }
}
