import { PREFIXED } from './utils/id-words.js';

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

  /** Whether another id has the body of `id` after its own prefix (`Gateway_AfterCheck` for `Activity_AfterCheck`): a flow between them would name both alike. */
  bodyTaken(id: string): boolean {
    const at = id.indexOf('_');
    if (at === -1) return false;
    const tail = id.slice(at);
    for (const other of this.used) if (other !== id && other.endsWith(tail) && PREFIXED.test(other) && other.indexOf('_') === other.length - tail.length) return true;
    return false;
  }
}
