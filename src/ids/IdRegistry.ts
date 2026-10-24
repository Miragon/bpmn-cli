/** Every id of the document (BPMN, DI and vendor ids), so that a new id never collides. */
export class IdRegistry {
  private readonly used = new Set<string>();

  constructor(existing: Iterable<string> = []) {
    for (const id of existing) this.used.add(id);
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

  /** The ids in use. */
  values(): IterableIterator<string> {
    return this.used.values();
  }
}
